import logging
import os
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

RETRIEVE_RESULT_COUNT = 5
NO_CONTEXT_ANSWER = (
    "I do not have enough information in the medical library to answer that. "
    "Please ask a question covered by the Gold Standard sources, or add more detail."
)

GENERATION_INSTRUCTIONS = (
    "You are a clinical support assistant for people with Type 1 diabetes and the clinicians "
    "who care for them. Use ONLY the medical library context below to answer. If the context "
    "does not contain the answer, say so. Organize the response in an easy-to-read format at a "
    "6th grade reading level without emojis. Address the user directly. Do not use third-person "
    "pronouns for the user. Do not invent sources or clinical facts that are not in the context."
    "Express your answers in an educational format and only give suggestions, and word it as"
    "lifestyle advice and not medical."
)


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

    @staticmethod
    def _source_from_result(result: Dict[str, Any]) -> Dict[str, Optional[str]]:
        location = result.get("location") or {}
        s3_uri = (location.get("s3Location") or {}).get("uri")
        metadata = result.get("metadata") or {}
        source = s3_uri or metadata.get("x-amz-bedrock-kb-source-uri") or metadata.get("source")
        title = metadata.get("title") or (source.split("/")[-1] if source else None)
        http_url = s3_uri if s3_uri and s3_uri.startswith("http") else None
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
    def _format_conversation(conversation_history: List[Dict[str, Any]]) -> str:
        if not conversation_history:
            return "(none)"
        return "\n".join(
            f"User: {turn.get('user_query', '')}\nAssistant: {turn.get('agent_response', '')}"
            for turn in conversation_history
        )

    def _build_prompt(
        self,
        conversation_history: List[Dict[str, Any]],
        query: str,
        docs: List[Dict[str, Any]],
    ) -> str:
        context_blocks = []
        for i, result in enumerate(docs, start=1):
            text = self._chunk_text(result).strip()
            source = self._source_from_result(result)
            label = source.get("title") or source.get("source") or f"chunk {i}"
            context_blocks.append(f"[Source {i}: {label}]\n{text}")

        context = "\n\n".join(context_blocks) if context_blocks else "(no library excerpts)"

        return (
            f"{GENERATION_INSTRUCTIONS}\n\n"
            f"Medical library context:\n{context}\n\n"
            f"Ongoing conversation history:\n{self._format_conversation(conversation_history)}\n\n"
            f"Clinician's latest request:\n{query}\n"
        )

    def _generate(self, prompt: str) -> str:
        response = self.runtime.converse(
            modelId=self.model_id,
            messages=[
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            inferenceConfig={
                "maxTokens": 1024,
                "temperature": 0.2,
            },
        )
        parts = response.get("output", {}).get("message", {}).get("content") or []
        texts = [part.get("text", "") for part in parts if part.get("text")]
        return "\n".join(texts).strip()

    def process_query(
        self,
        conversation_history: List[Dict[str, Any]],
        query: str,
    ) -> Dict[str, Any]:
        logging.info(
            "Processing query. conversation_turns=%s",
            len(conversation_history or []),
        )

        try:
            docs = self._retrieve_docs(query)
            usable_docs = [doc for doc in docs if self._chunk_text(doc).strip()]
            logging.info("Bedrock Retrieve returned %s usable chunk(s).", len(usable_docs))

            if not usable_docs:
                return {"answer": NO_CONTEXT_ANSWER, "sources": []}

            prompt = self._build_prompt(conversation_history or [], query, usable_docs)
            answer = self._generate(prompt)
            sources = [self._source_from_result(doc) for doc in usable_docs]

            seen = set()
            unique_sources = []
            for source in sources:
                key = source.get("source") or source.get("title")
                if key in seen:
                    continue
                seen.add(key)
                unique_sources.append(source)

            return {"answer": answer, "sources": unique_sources}
        except (ClientError, BotoCoreError) as exc:
            logging.error("Bedrock RAG invocation failed: %s", exc)
            return {"error": f"Failed to process query: {exc}"}
        except Exception as exc:
            logging.error("RAG query failed: %s", exc)
            return {"error": f"Failed to process query: {exc}"}
