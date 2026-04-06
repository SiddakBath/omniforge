# Example: Gmail investor monitor

Prompt:

> I need an agent that monitors my Gmail for investor replies and drafts follow-ups in my voice.

Expected generator behavior:

1. Audit existing skills.
2. Create `gmail-reader`, `gmail-drafter`, and `voice-style-adapter` if missing.
3. Request required params:
   - `GMAIL_CLIENT_ID`
   - `GMAIL_CLIENT_SECRET`
   - `GMAIL_REFRESH_TOKEN`
   - `USER_VOICE_EXAMPLES`
4. Build agent system prompt with all skill instruction blocks.
5. Start runtime loop once params are satisfied.
