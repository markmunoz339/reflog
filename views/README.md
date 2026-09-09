# RefLog

A personal referee game tracker — not tied to any one league or organization.
Add every game you're assigned across any org you ref for, log it when you
give a game away or pick one up from another ref, track what you're owed,
and sync it all to your phone's calendar.

## Running locally

```
npm install
node server.js
```

Visit http://localhost:3000

## Deploying

Same pattern as Reffi: push this to its own GitHub repo, connect it to a new
Railway service, and Railway auto-deploys on every push. No environment
variables are required to get started — see `.env.example`.

## How it works

- **No admin** — this is a personal tool. Anyone creates their own profile
  (name + a PIN they pick) and only ever sees their own games.
- **Games** — add a game with date/time/location/league/notes/pay. Mark it
  as "picked up from" someone else when adding, or edit any game later to
  mark it "given away to" someone — given-away games stay visible (struck
  through) for your records but don't count toward your totals.
- **Stats** — games worked and money earned this week / this month / all
  time, automatically excluding anything you've given away.
- **Calendar** — download this week's games as a one-time .ics, or subscribe
  to a webcal:// feed that stays current as you add/edit/swap games.
