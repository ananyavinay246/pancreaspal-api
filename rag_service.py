import hashlib
import logging
import os
from typing import Any, Dict, List, Literal, Optional, TypedDict
from urllib.parse import urlparse

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

RETRIEVE_RESULT_COUNT = 5
NO_CONTEXT_ANSWER = (
    "I do not have enough information in the medical library to answer that. "
    "Please ask a question covered by the Gold Standard sources, or add more detail."
)

GENERATION_INSTRUCTIONS = (
    "You are an educational support assistant for people with Type 1 diabetes."
    "Use ONLY the medical library context below to answer. If the context "
    "does not contain the answer, say so. Organize the response in an easy-to-read format at a "
    "6th grade reading level without emojis. Address the user directly. Do not use third-person "
    "pronouns for the user. Do not invent sources or clinical facts that are not in the context."
    "Express your answers in an educational format and only give suggestions, and word it as "
    "lifestyle advice and not medical."
)

CONCISE_GENERAL_SUFFIX = (
    " LENGTH: Give a brief answer only — about 150–200 words maximum. Use at most 2–4 short "
    "paragraphs or a small bullet list. No long introductions or recap of the question."
)

DETAILED_GENERAL_SUFFIX = (
    " LENGTH: Give a thorough, well-structured answer. Use clear sections or bullets, include "
    "helpful examples from the medical library context when available, and stay within the "
    "facts in the context."
)

METRICS_MODE_INSTRUCTIONS = (
    "You are a wellness companion helping someone review their own Type 1 diabetes logs. "
    "Use the User logged metrics block for factual summaries only (counts, averages, dates, "
    "patterns visible in the data). You may use the medical library for general definitions "
    "and education, but do NOT apply library guidance to the user's specific numbers or logs. "
    "Do NOT give recommendations, prescriptions, or action steps about insulin, food, exercise, "
    "or mood. Do NOT say what they should do, whether values are good or bad for action, or "
    "imply a care plan. If they ask for advice about their data, briefly summarize relevant "
    "logs and suggest they use Learn mode for general education or talk with their care team. "
    "Organize the response at a 6th grade reading level without emojis. Address the user "
    "directly. Do not invent log entries or numbers not in the metrics block."
)

CONCISE_METRICS_SUFFIX = (
    " LENGTH: Summarize only the most important facts from the logs in about 150–250 words. "
    "No recommendations or action steps."
)

DETAILED_METRICS_SUFFIX = (
    " LENGTH: Provide a fuller factual summary of the logs — patterns, counts, dates, and "
    "comparisons visible in the data. Still do NOT give recommendations or action steps."
)

DETAILED_EXPANSION_BLOCK = (
    "The user already received this brief answer:\n{prior}\n\n"
    "Now write a longer, more in-depth answer to the same request. Build on the brief answer "
    "without contradicting it. Add detail from the medical library context and metrics block only "
    "where supported."
)

NO_METRICS_DATA_ANSWER = (
    "You have not logged any health metrics yet. Use Log on the home screen to add readings, "
    "meals, activity, or mood — then ask again to summarize your logs."
)


class RAGPromptContext(TypedDict):
    query: str
    query_mode: str
    patient_history: str
    conversation_history: List[Dict[str, Any]]
    metrics_context: Optional[str]
    retrieved_docs: List[Dict[str, Any]]


class RAGService:
    def __init__(self):
        self.region = os.getenv("AWS_REGION", "us-east-1")
        self.knowledge_base_id = os.getenv("BEDROCK_KNOWLEDGE_BASE_ID", "").strip()
        self.model_id = os.getenv("BEDROCK_MODEL_ID", "").strip()

        missing = []
        if not self.knowledge_base_id:
            missing.append("BEDROCK_KNOWLEDGE_BASE_ID")
        if not self.model_id:
            missing.append("BEDROCK_MODEL_ID")
        if missing:
            raise ValueError(
                "Missing required Bedrock configuration: "
                + ", ".join(missing)
                + ". Add them to your .env file. See .env.example."
            )

        logging.info("Initializing RAG Service (Bedrock Knowledge Base)...")
        self.agent_runtime = boto3.client("bedrock-agent-runtime", region_name=self.region)
        self.runtime = boto3.client("bedrock-runtime", region_name=self.region)
        self._s3 = boto3.client("s3", region_name=self.region)
        logging.info(
            "RAG Service initialized. region=%s knowledge_base_id=%s model_id=%s",
            self.region,
            self.knowledge_base_id,
            self.model_id,
        )

    def _retrieve_docs(self, query: str) -> List[Dict[str, Any]]:
        response = self.agent_runtime.retrieve(
            knowledgeBaseId=self.knowledge_base_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "managedSearchConfiguration": {
                    "numberOfResults": RETRIEVE_RESULT_COUNT,
                }
            },
        )
        results = response.get("retrievalResults") or []
        self._print_retrieved_chunks(query, results)
        return results

    def _print_retrieved_chunks(self, query: str, results: List[Dict[str, Any]]) -> None:
        print("\n========== Bedrock Retrieve ==========", flush=True)
        print(f"Query: {query}", flush=True)
        print(f"Chunks: {len(results)}", flush=True)
        if not results:
            print("(no chunks returned)", flush=True)
            print("======================================\n", flush=True)
            return

        for i, result in enumerate(results, start=1):
            source = self._source_from_result(result)
            label = source.get("title") or source.get("source") or "(unknown source)"
            score = result.get("score")
            text = self._chunk_text(result).strip()
            print(f"\n--- Chunk {i} ---", flush=True)
            print(f"Source: {label}", flush=True)
            if source.get("source") and source.get("source") != label:
                print(f"URI: {source['source']}", flush=True)
            if score is not None:
                print(f"Score: {score}", flush=True)
            print(f"Text:\n{text}", flush=True)

        print("======================================\n", flush=True)

    def _presigned_url_for_s3(self, s3_uri: str) -> Optional[str]:
        if not s3_uri.startswith("s3://"):
            return None
        parsed = urlparse(s3_uri)
        bucket = parsed.netloc
        key = parsed.path.lstrip("/")
        if not bucket or not key:
            return None
        try:
            return self._s3.generate_presigned_url(
                ClientMethod="get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=3600,
            )
        except (ClientError, BotoCoreError) as exc:
            logging.warning("Could not presign %s: %s", s3_uri, exc)
            return None

    def _source_from_result(self, result: Dict[str, Any]) -> Dict[str, Optional[str]]:
        location = result.get("location") or {}
        s3_uri = (location.get("s3Location") or {}).get("uri")
        metadata = result.get("metadata") or {}
        source = s3_uri or metadata.get("x-amz-bedrock-kb-source-uri") or metadata.get("source")
        title = metadata.get("title") or (source.split("/")[-1] if source else None)

        http_url: Optional[str] = None
        for candidate in (
            metadata.get("url"),
            metadata.get("source_url"),
            metadata.get("x-amz-bedrock-kb-source-uri"),
            source,
            s3_uri,
        ):
            if isinstance(candidate, str) and candidate.startswith(("http://", "https://")):
                http_url = candidate
                break

        if not http_url:
            for candidate in (s3_uri, source):
                if isinstance(candidate, str) and candidate.startswith("s3://"):
                    http_url = self._presigned_url_for_s3(candidate)
                    if http_url:
                        break

        return {
            "source": source,
            "url": http_url,
            "title": title,
        }

    @staticmethod
    def _chunk_text(result: Dict[str, Any]) -> str:
        content = result.get("content") or {}
        return content.get("text") or ""

    @staticmethod
    def _serialize_retrieved_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
        """Persist minimal retrieve shape so expand can rebuild the same prompt context."""
        metadata = doc.get("metadata") or {}
        safe_meta = {str(k): v for k, v in metadata.items() if isinstance(v, (str, int, float, bool))}
        location = doc.get("location") or {}
        s3_loc = (location.get("s3Location") or {}) if isinstance(location, dict) else {}
        uri = s3_loc.get("uri") if isinstance(s3_loc, dict) else None
        stored_location: Dict[str, Any] = {}
        if isinstance(uri, str) and uri:
            stored_location = {"s3Location": {"uri": uri}}
        return {
            "content": {"text": RAGService._chunk_text(doc)},
            "metadata": safe_meta,
            "location": stored_location,
        }

    def _unique_sources(self, docs: List[Dict[str, Any]]) -> List[Dict[str, Optional[str]]]:
        sources = [self._source_from_result(doc) for doc in docs]
        seen = set()
        unique_sources: List[Dict[str, Optional[str]]] = []
        for source in sources:
            key = source.get("source") or source.get("title")
            if key in seen:
                continue
            seen.add(key)
            unique_sources.append(source)
        return unique_sources

    def _build_prompt_context(
        self,
        *,
        query: str,
        query_mode: str,
        patient_history: str,
        conversation_history: List[Dict[str, Any]],
        metrics_context: Optional[str],
        usable_docs: List[Dict[str, Any]],
    ) -> RAGPromptContext:
        return {
            "query": query,
            "query_mode": query_mode,
            "patient_history": patient_history or "",
            "conversation_history": list(conversation_history or []),
            "metrics_context": metrics_context,
            "retrieved_docs": [self._serialize_retrieved_doc(doc) for doc in usable_docs],
        }

    def _generate_from_docs(
        self,
        *,
        patient_history: str,
        conversation_history: List[Dict[str, Any]],
        query: str,
        usable_docs: List[Dict[str, Any]],
        query_mode: str,
        metrics_context: Optional[str],
        response_detail: str,
        prior_answer: Optional[str] = None,
    ) -> Dict[str, Any]:
        prompt = self._build_prompt(
            patient_history,
            conversation_history or [],
            query,
            usable_docs,
            query_mode=query_mode,
            metrics_context=metrics_context,
            response_detail=response_detail,
            prior_answer=prior_answer,
        )
        answer = self._generate(prompt, response_detail=response_detail)
        return {
            "answer": answer,
            "sources": self._unique_sources(usable_docs),
            "query_mode": query_mode,
        }

    @staticmethod
    def _format_conversation(conversation_history: List[Dict[str, Any]]) -> str:
        if not conversation_history:
            return "(none)"
        return "\n".join(
            f"User: {turn.get('user_query', '')}\nAssistant: {turn.get('agent_response', '')}"
            for turn in conversation_history
        )
        
    @staticmethod
    def _length_suffix(query_mode: str, response_detail: str) -> str:
        if query_mode == "metrics":
            return DETAILED_METRICS_SUFFIX if response_detail == "detailed" else CONCISE_METRICS_SUFFIX
        return DETAILED_GENERAL_SUFFIX if response_detail == "detailed" else CONCISE_GENERAL_SUFFIX

    def _build_prompt(
        self,
        patient_history: str,
        conversation_history: List[Dict[str, Any]],
        query: str,
        docs: List[Dict[str, Any]],
        query_mode: str = "general",
        metrics_context: Optional[str] = None,
        response_detail: str = "concise",
        prior_answer: Optional[str] = None,
    ) -> str:
        context_blocks = []
        for i, result in enumerate(docs, start=1):
            text = self._chunk_text(result).strip()
            source = self._source_from_result(result)
            label = source.get("title") or source.get("source") or f"chunk {i}"
            context_blocks.append(f"[Source {i}: {label}]\n{text}")

        context = "\n\n".join(context_blocks) if context_blocks else "(no library excerpts)"
        history = (patient_history or "").strip() or "(not provided)"
        base = METRICS_MODE_INSTRUCTIONS if query_mode == "metrics" else GENERATION_INSTRUCTIONS
        instructions = base + self._length_suffix(query_mode, response_detail)
        metrics_block = ""
        if query_mode == "metrics" and (metrics_context or "").strip():
            metrics_block = (
                f"User logged metrics (factual source for summaries):\n"
                f"{metrics_context.strip()}\n\n"
            )

        expansion_block = ""
        if response_detail == "detailed" and (prior_answer or "").strip():
            expansion_block = DETAILED_EXPANSION_BLOCK.format(prior=prior_answer.strip()) + "\n\n"

        return (
            f"{instructions}\n\n"
            f"{expansion_block}"
            f"{metrics_block}"
            f"Medical library context:\n{context}\n\n"
            f"Static patient history:\n{history}\n\n"
            f"Ongoing conversation history:\n{self._format_conversation(conversation_history)}\n\n"
            f"User's latest request:\n{query}\n"
        )

    def _generate(self, prompt: str, response_detail: str = "concise") -> str:
        max_tokens = 1024 if response_detail == "detailed" else 400
        response = self.runtime.converse(
            modelId=self.model_id,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            inferenceConfig={
                "maxTokens": max_tokens,
                "temperature": 0.2,
            },
        )
        parts = response.get("output", {}).get("message", {}).get("content") or []
        texts = [part.get("text", "") for part in parts if part.get("text")]
        return "\n".join(texts).strip()

    def process_query(
        self,
        patient_history: str,
        conversation_history: List[Dict[str, Any]],
        query: str,
        query_mode: str = "general",
        metrics_context: Optional[str] = None,
        response_detail: Literal["concise", "detailed"] = "concise",
        prior_answer: Optional[str] = None,
    ) -> Dict[str, Any]:
        history_bytes = (patient_history or "").encode("utf-8")
        logging.info(
            "Processing query. query_mode=%s response_detail=%s patient_history_chars=%s "
            "patient_history_sha256=%s conversation_turns=%s metrics_context_chars=%s",
            query_mode,
            response_detail,
            len(patient_history or ""),
            hashlib.sha256(history_bytes).hexdigest()[:12],
            len(conversation_history or []),
            len(metrics_context or ""),
        )

        try:
            docs = self._retrieve_docs(query)
            usable_docs = [doc for doc in docs if self._chunk_text(doc).strip()]
            logging.info("Bedrock Retrieve returned %s usable chunk(s).", len(usable_docs))

            has_metrics = bool((metrics_context or "").strip())
            if not usable_docs:
                if query_mode == "metrics" and has_metrics:
                    usable_docs = []
                else:
                    return {"answer": NO_CONTEXT_ANSWER, "sources": [], "query_mode": query_mode}

            if query_mode == "metrics" and not usable_docs and not has_metrics:
                return {"answer": NO_METRICS_DATA_ANSWER, "sources": [], "query_mode": query_mode}

            generated = self._generate_from_docs(
                patient_history=patient_history,
                conversation_history=conversation_history or [],
                query=query,
                usable_docs=usable_docs,
                query_mode=query_mode,
                metrics_context=metrics_context,
                response_detail=response_detail,
                prior_answer=prior_answer,
            )
            prompt_context = self._build_prompt_context(
                query=query,
                query_mode=query_mode,
                patient_history=patient_history,
                conversation_history=conversation_history or [],
                metrics_context=metrics_context,
                usable_docs=usable_docs,
            )
            return {
                **generated,
                "rag_prompt_context": prompt_context,
            }
        except (ClientError, BotoCoreError) as exc:
            logging.error("Bedrock RAG invocation failed: %s", exc)
            return {"error": f"Failed to process query: {exc}"}
        except Exception as exc:
            logging.error("RAG query failed: %s", exc)
            return {"error": f"Failed to process query: {exc}"}

    def expand_from_stored_context(
        self,
        stored: RAGPromptContext,
        prior_answer: str,
    ) -> Dict[str, Any]:
        """Detailed answer using the retrieve + prompt snapshot from the concise turn."""
        query_mode = stored.get("query_mode") or "general"
        metrics_context = stored.get("metrics_context")
        has_metrics = bool((metrics_context or "").strip())
        usable_docs = list(stored.get("retrieved_docs") or [])

        logging.info(
            "Expanding from stored context. query_mode=%s stored_chunks=%s metrics_context_chars=%s",
            query_mode,
            len(usable_docs),
            len(metrics_context or ""),
        )

        try:
            if not usable_docs:
                if query_mode == "metrics" and has_metrics:
                    pass
                else:
                    return {"answer": NO_CONTEXT_ANSWER, "sources": [], "query_mode": query_mode}

            if query_mode == "metrics" and not usable_docs and not has_metrics:
                return {"answer": NO_METRICS_DATA_ANSWER, "sources": [], "query_mode": query_mode}

            return self._generate_from_docs(
                patient_history=stored.get("patient_history") or "",
                conversation_history=stored.get("conversation_history") or [],
                query=stored.get("query") or "",
                usable_docs=usable_docs,
                query_mode=query_mode,
                metrics_context=metrics_context,
                response_detail="detailed",
                prior_answer=prior_answer,
            )
        except (ClientError, BotoCoreError) as exc:
            logging.error("Bedrock expand invocation failed: %s", exc)
            return {"error": f"Failed to process query: {exc}"}
        except Exception as exc:
            logging.error("RAG expand failed: %s", exc)
            return {"error": f"Failed to process query: {exc}"}
