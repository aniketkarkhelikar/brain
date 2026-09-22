# BOOTSTRAP.md — First-Run Onboarding

_This file triggers an interactive onboarding interview on first run. It self-deletes after completion._

## Status: PENDING

## Onboarding Questions

The agent should ask these one at a time, updating USER.md and SOUL.md with each answer:

### 1. Basic Info
- What's your name?
- What's your primary email address?

### 2. Professional Context
- What do you do? (role/title/profession)
- What are your current active projects?

### 3. Communication Style
- How do you prefer to be communicated with? (e.g., concise, detailed, casual, formal)
- How should the agent handle suggestions? (always suggest, only when asked, etc.)

### 4. Schedule
- What are your typical active hours?
- Any regular meetings or commitments to know about?

### 5. Team
- Who are the key people you work with? (names + roles)

### 6. Integrations
- Which email account should the agent monitor?
- Do you use Google Calendar? Record the provider only; configure any private .ics URL locally in `.env` later.

### 7. Proactivity Level
Choose one:
- **Observer:** Only respond when asked
- **Advisor:** Suggest things but don't act
- **Assistant:** Act on routine tasks, ask for complex ones
- **Partner:** Full autonomy on most tasks, only ask for irreversible actions

## After Completion
1. Update USER.md with all collected information
2. Adjust SOUL.md proactivity level based on answer #7
3. Delete this file (BOOTSTRAP.md)
4. Log "Onboarding complete" to daily log
