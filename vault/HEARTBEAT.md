# HEARTBEAT.md — Proactive Checklist

_This file defines what to check during heartbeat runs (every 30 minutes)._

## Quick Checks (Every Heartbeat)

- [ ] Any urgent emails in the last 2 hours?
- [ ] Any calendar events in the next 4 hours?
- [ ] Any unprocessed items in Inbox/?

## Proactive Suggestions (Every Heartbeat)

After reviewing the data above, think about:
- [ ] What should be prioritized right now given the calendar and deadlines?
- [ ] Is there anything coming up that needs prep and doesn't have it yet?
- [ ] Are there any patterns in recent emails worth noting?

## Anomaly Detection

Flag anything unusual:
- [ ] Spike in unread email count (vs normal baseline)
- [ ] Cancelled or moved meetings that weren't expected

## Periodic Checks (Rotate Through)

### Memory Maintenance (Daily)
- [ ] Review yesterday's daily log
- [ ] Extract anything worth adding to MEMORY.md
- [ ] Run wiki lint (check for broken [[wikilinks]], orphan pages)

### Inbox Compilation (Every Heartbeat)
- [ ] Scan Inbox/ for unprocessed files
- [ ] Compile into Knowledgebase/ wiki pages
- [ ] Update index.md with new pages

## When to Notify

**Notify immediately:**
- Urgent email from important contacts
- Calendar event starting in < 2 hours with no prep notes

**Batch for next interaction:**
- Non-urgent emails
- Interesting but not urgent information

**Stay silent (HEARTBEAT_OK):**
- Nothing new since last check
- Outside active hours (before 8am, after 10pm IST)
