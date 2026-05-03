---
name: morning-update
description: Daily morning briefing recipe — pulls tasks, weather, habits, reading, security, projects, and parking lot into a tight Telegram message. Triggered by the 6:45 AM scheduled task.
---

# Morning Update

Generate and send Mark's daily morning update. Follow these instructions exactly.

## Data Sources

- **Tasks**: Read `/workspace/extra/Mark-main/Tasks/tasks.md`
- **Habits/Goals**: Check memory for recent check-in data (reading progress, nutrition, fitness/training)
- **Parking lot**: Check memory for parking lot items
- **Weather**: Fetch from Open-Meteo API for Atlanta, GA (lat=33.7490, lon=-84.3880)
- **Reading library counts**: Query Athenaeum for today's Curator run: `mcp__athenaeum__get_context("Curator daily run log today", recency_boost: 0.9, verbosity: "brief")`
- **Security report**: Read `/workspace/extra/Mark-main/Security/sentinel-YYYY-MM-DD.md` (use today's date)
- **Context**: Query Athenaeum for recent activity and goals: `mcp__athenaeum__get_context("Mark's recent activity and updates", recency_boost: 0.3, verbosity: "brief")`

## Weather (Weekdays Only)

Today is a weekday. Fetch hourly weather for today from Open-Meteo:

```
https://api.open-meteo.com/v1/forecast?latitude=33.7490&longitude=-84.3880&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FNew_York&forecast_days=1
```

Report conditions for:
- Morning commute window: 7–9 AM
- Afternoon commute window: 4–6 PM

Include a 🚲 *Bike Commute Weather* section with temp, precipitation chance, and wind for each window. Flag anything that warrants preparation (rain >30%, wind >15mph, thunderstorms, extreme heat/cold). If conditions are fine, say so briefly. Keep it to 3–4 lines. Include 3-4 lines on suggested gear based on the weather.

Weather codes reference: 0=clear, 1-3=partly cloudy, 45/48=fog, 51-67=drizzle/rain, 71-77=snow, 80-82=showers, 95-99=thunderstorm

## Task Format

Tasks in `tasks.md` use this format:
- `## [ ] Task title` = open task
- `## [x] Task title` = done
- Metadata in HTML comment below: `<!-- id:N priority:critical due:YYYY-MM-DD ... -->`

## What to Include

### 1. Critical & High Tasks This Week

Read `tasks.md` and find ALL open tasks (`[ ]`) where `priority:critical` OR `priority:high` in the metadata AND `due:` date falls within the current week (Mon–Sun). Do not include medium or low priority tasks.

### 2. Today's Schedule

Query Athenaeum for today's training schedule and any scheduled events: `mcp__athenaeum__get_context("Mark's training schedule and upcoming events", verbosity: "brief")`. Also check tasks for events or deadlines within 2 weeks. If a race or event is within 2 weeks, include a countdown. Keep it to 2-3 lines of what's notable about today specifically.

Habits are handled by Praxis (6:45 AM reminder) — do NOT duplicate habit tracking here.

### 3. Reading

Include a brief *Reading* section using counts from today's Curator run.

Use the Curator run log from Athenaeum (fetched in Data Sources) and produce a one-line summary in this format:

> 📚 *Reading*: N new tagged today · top: ai (X), engineering-leadership (Y), health-fitness (Z) · N moved to shortlist · N unsorted

Rules:
- Show only the top 3 categories by count
- Always show shortlist count (it's actionable)
- Always show unsorted count (it signals review needed)
- If no entry for today: "📚 *Reading*: no Curator run today" (one line)
- Do NOT list specific articles. Curator no longer recommends — Mark goes to Readwise to find things by tag.

### 4. Security

Always include a *Security* section. Check for today's Sentinel report at `/workspace/extra/Mark-main/Security/sentinel-YYYY-MM-DD.md`:
- If there are "Action Required" items, list them (1 line each, max 3)
- If all clear, one line: "✅ Security: all clear"
- If no report exists for today, one line: "⚠️ Security: no report from Sentinel today (last scan: <date of most recent file in Security/>)"

Never skip this section silently — Mark needs to know if Sentinel is failing to run.

## Format

Tight and scannable. Use Telegram formatting (`*bold*`, `•` bullets). Start with a friendly good morning greeting and the date. Send as a message to Mark using `send_message`.

## Rules

- Only CRITICAL and HIGH priority tasks in the tasks section
- Use Athenaeum for all context (training schedule, routines, recent activity) — queries are already specified in Data Sources above
- Do NOT mention this is a scheduled task
- Keep it under ~50 lines total
