"""Handbook RAG chatbot."""

from dotenv import load_dotenv

# Read API keys from .env.local if it exists (same file name as the Node version).
load_dotenv(".env.local")

# Behind a proxy or antivirus that re-signs HTTPS traffic, Python's bundled
# certificates can fail with CERTIFICATE_VERIFY_FAILED. truststore makes Python
# use the operating system's certificates instead, which is the same idea as
# NODE_USE_SYSTEM_CA in Node. It does not turn certificate checking off.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:
    pass
