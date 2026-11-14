# Backend administration

## Platform statistics

The platform statistics page is available only to accounts with
`accounts.is_platform_admin = 1` in the authentication database. The backend
adds this column automatically when it starts; existing accounts default to
`0`.

To grant platform-admin access to an existing account, run this statement
against the authentication database:

```sql
UPDATE accounts
SET is_platform_admin = 1
WHERE email = 'admin@example.com';
```

In the Docker Compose setup, the database is `/data/auth.sqlite3` inside the
backend container and is persisted in the `backend-data` volume. After changing
the role, reload the application so the account's permissions are refreshed.

The statistics contain aggregate counts for calendars, login accounts, family
profiles, time blocks, and tasks; they do not return account or calendar
contents.

## Family data synchronization

Each family calendar database keeps a revision counter that SQLite triggers
advance when shared calendar data changes. Authenticated clients can check
`GET /api/sync/version`; the frontend polls this endpoint every five seconds
while visible and reloads shared data when the revision changes. This is a
change signal, not a per-client event queue, so clients that reconnect simply
reload the current family data.

Error reports are stored in the central `auth.sqlite3` database so reports
about the application are not tied to an individual family's calendar. On
startup, reports from older family databases are moved into the central
database.

Platform admins can remove another login account from the statistics page.
This also removes its linked family profile and personal time blocks, plan
assignment, event types, and task participation. Tasks assigned only to the
deleted profile are removed; shared tasks, plans, categories, and other
profiles remain. The signed-in platform-admin account and the last platform
admin cannot be removed this way.

## Running tests

Install the development dependencies and run the backend test suite from this
directory:

```bash
python -m pip install -r requirements-dev.txt
python -m pytest -q
```
