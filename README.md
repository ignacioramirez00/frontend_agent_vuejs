
## Run Locally

**Prerequisites:**  Node.js

1. Install dependencies:
   `npm install`
2. Configure the environment:
   `cp .env.example .env` and fill in the values (test session id + `userContext`).
   `.env` is gitignored — user data must never be committed.
3. Start the Chatbot backend (FastAPI) on port 8000, then run the app:
   `npm run dev`
