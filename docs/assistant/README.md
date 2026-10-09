# Tixflow website assistant

The chat assistant on the Tixflow website runs on the Biz Smart agent server (`~/work/agent`), with Tixflow as one tenant. It has two parts:

- **Knowledge base:** upload `tixflow-faq.md` on the tenant's Knowledge base page.
- **Tools:** two HTTP tools, added on the Tools page, that call Tixflow's `/api/assistant/*` endpoints.

## 0. The chat widget on the site

`src/components/site/AssistantWidget.tsx` (mounted in `_app.tsx`) loads the widget script with Tixflow's widget key and `data-theme="dark"`. It's hidden on `/dashboard`, `/platform-admin`, `/space` and `/exhibitor`. The widget server only answers websites on the assistant's allowed list, so add Tixflow's live domain there (and `http://localhost:3000` if you want it in development).

## 1. Set the key in Tixflow

Generate a key and add it to Tixflow's environment (`.env` locally, and the Render dashboard in production):

```
openssl rand -base64 32
ASSISTANT_API_KEY=<that value>
```

Every `/api/assistant/*` request must send `Authorization: Bearer <ASSISTANT_API_KEY>`. Without the variable the endpoints answer 503.

## 2. Add the tools (agent → Tools page)

The agent server only calls public URLs, so use the deployed Tixflow address (`NEXT_PUBLIC_APP_URL`), not localhost. Set `ALLOW_PRIVATE_TOOL_URLS=true` on the agent only to test against a local Tixflow.

### send_ticket_link

| Field | Value |
|---|---|
| Name | `send_ticket_link` |
| Label | Send a buyer the link to their tickets |
| Description | Emails the visitor a link to view their Tixflow tickets (and sends it to WhatsApp too, if the number is the one they gave at checkout). Use when someone has lost their tickets or can't find their ticket email. Ask for the email they used when buying; the WhatsApp number is optional. You never see the link and are not told whether the email has tickets. |
| Method | POST |
| URL | `https://<tixflow-domain>/api/assistant/send-ticket-link` |
| Secret header | `Authorization` = `Bearer <ASSISTANT_API_KEY>` |
| Parameters | `email` (text, required): "The email address the visitor used when buying the tickets." · `whatsapp` (text, optional): "The WhatsApp number the visitor gave at checkout, e.g. 0712345678." |
| Audience | Website visitors + staff |

Tixflow answers with `tell_the_visitor` (what to say) and `rules_for_the_assistant`. The same limits as the "Find my tickets" page apply: 3 requests per email every 15 minutes (shared with the page), plus 200 across the assistant every 15 minutes.

### find_events

| Field | Value |
|---|---|
| Name | `find_events` |
| Label | Find upcoming events |
| Description | Lists upcoming events on Tixflow (up to 10, soonest first) with date, venue, organiser, starting price and the link to buy. Pass a word from the event name, category or location to narrow it, or nothing to see what's coming up. |
| Method | GET |
| URL | `https://<tixflow-domain>/api/assistant/events` |
| Secret header | `Authorization` = `Bearer <ASSISTANT_API_KEY>` |
| Parameters | `q` (text, optional): "A word from the event's name, category or location, e.g. jazz, conference, Nairobi." |
| Audience | Website visitors + staff |

## 3. Suggested assistant instructions

> You are the assistant on the Tixflow website, a ticketing platform for events in Kenya. Answer from the knowledge base; if it doesn't cover something, say so rather than guessing. Questions about a specific event's details (line-up, parking, dress code) go to that event's organiser, whose name is on the event page.
> When someone can't find their tickets, ask for the email they used when buying (and, optionally, the WhatsApp number from checkout), then use send_ticket_link. Never claim to know whether an email has tickets, and never ask for M-Pesa PINs, card numbers or passwords.
> When someone asks what's on, or about a specific event, use find_events and share the event link.
