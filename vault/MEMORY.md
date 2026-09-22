# MEMORY.md — Key Facts & Decisions

_This file is loaded into every conversation. Keep it concise._

## Active Projects
- **AI Second Brain:** Building a proactive personal AI assistant with Vercel AI SDK + Ollama

## Key Decisions
- Using `qwen2.5:14b` on lab52 GPU server for inference
- Vercel AI SDK v5+ for tool calling and agent loops
- TypeScript/Node.js stack (not Python)
- SQLite for local search (sqlite-vec + FTS5)
- Vault is plain markdown files, Git-versioned

## Infrastructure
- **lab52** (`172.25.128.20`): Remote GPU server running Ollama
- **Local PC**: Runs the Node.js agent, stores the vault
- SSH access via `remote_exec.py` (paramiko)

## Lessons Learned
- (Populated as the agent encounters issues and solutions)

## Important Facts
- (Populated as the agent learns about you and your work)
