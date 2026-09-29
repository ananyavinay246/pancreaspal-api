from dotenv import load_dotenv
from rag_service import RAGService

load_dotenv()

rag = RAGService()

response = rag.process_query(
    conversation_history=[
        {
            "user_query": "Patient reports feeling shaky and sweaty.",
            "agent_response": "Those symptoms can be related to low blood sugar. I can look that up against the medical library.",
        }
    ],
    query="What could these symptoms indicate?",
)

print(response)
