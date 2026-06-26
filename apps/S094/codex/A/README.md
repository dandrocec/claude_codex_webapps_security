# Express Integration Hub

A Node.js/Express integration hub where users can register inbound webhooks, configure outbound HTTP actions, inspect recent events and deliveries, and retry failed deliveries. Configuration and logs are stored in SQLite.

## Run locally

```bash
npm install
npm start
```

The app listens on port `5094` by default:

```text
http://localhost:5094
```

You can override the port with:

```bash
PORT=5094 npm start
```

## Usage

1. Register a user account.
2. Create a webhook from the dashboard.
3. Add one or more outbound actions with destination URLs.
4. Send an event to the generated webhook URL using any HTTP method.
5. View event and delivery logs from the dashboard.
6. Retry a failed or completed delivery from its retry button.

The SQLite database is created automatically at `data/hub.sqlite`.
