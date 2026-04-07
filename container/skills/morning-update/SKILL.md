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
- **Suggested reads**: Read `/workspace/extra/Mark-main/Readwise/suggested-reads.md`
- **Security report**: Read `/workspace/extra/Mark-main/Security/sentinel-YYYY-MM-DD.md` (use today's date)
- **Wiki**: Read relevant pages in `/workspace/extra/Mark-main/wiki/` for any context on goals, training, or routines that's already curated

## Weather (Weekdays Only)

Today is a weekday. Fetch hourly weather for today from Open-Meteo:

```
https://api.open-meteo.com/v1/forecast?latitude=33.7490&longitude=-84.3880&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=America%2FNew_York&forecast_days=1
```

Report conditions for:
- Morning commute window: 7–9 AM
- Afternoon commute window: 4–6 PM

Include a 🚲 *Bike Commute Weather* section with temp, precipitation chance, and wind for each window. Flag anything that warrants preparation (rain >30%, wind >15mph, thunderstorms, extreme heat/cold). If conditions are fine, say so briefly. Keep it to 3–4 lines.

Weather codes reference: 0=clear, 1-3=partly cloudy, 45/48=fog, 51-67=drizzle/rain, 71-77=snow, 80-82=showers, 95-99=thunderstorm

## Task Format

Tasks in `tasks.md` use this format:
- `## [ ] Task title` = open task
- `## [x] Task title` = done
- Metadata in HTML comment below: `<!-- id:N priority:critical due:YYYY-MM-DD ... -->`

## What to Include

### 1. Critical & High Tasks This Week

Read `tasks.md` and find ALL open tasks (`[ ]`) where `priority:critical` OR `priority:high` in the metadata AND `due:` date falls within the current week (Mon–Sun). Do not include medium or low priority tasks.

### 2. Habits

- **Reading**: current book, page, projected finish
- **Nutrition**: any recent Cronometer tracking status from memory
- **Fitness/Training**: today's scheduled activity (OTF = Sun/Tue/Fri, bike commute = Mon/Wed/Thu, rest = Sat), and countdown if race/event within 2 weeks

### 3. Reading

If `suggested-reads.md` exists, include a *Reading* section:
- List items from "Today's Picks" — title, source, and one-line pitch (max 3 items)
- If there's a Queue, note how many items are queued (e.g. "+8 in queue")
- Include the Reader URL for each pick so Mark can tap to open
- If the file doesn't exist or Today's Picks is empty, skip this section silently

### 4. Security

If today's Sentinel report exists (`sentinel-YYYY-MM-DD.md`), include a brief *Security* section:
- If there are "Action Required" items, list them (1 line each, max 3)
- If all clear, one line: "✅ Security: all clear"
- If no report exists, skip this section silently

### 5. Projects

Active personal projects from parking lot or memory (AI integrations, home org, etc.) — not work tasks.

### 6. Parking Lot

Current parking lot items from memory.

## Format

Tight and scannable. Use Telegram formatting (`*bold*`, `•` bullets). Start with a friendly good morning greeting and the date. Send as a message to Mark using `send_message`.

## Rules

- Only CRITICAL and HIGH priority tasks in the tasks section
- Check the wiki first for static knowledge (training schedule, routines), then fall back to broader memory for recent activity (preferring recent)
- Do NOT mention this is a scheduled task
- Keep it under ~50 lines total
