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
