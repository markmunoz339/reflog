// Minimal hand-rolled .ics (iCalendar) builder — no external dependency
// needed for something this small. Lets a ref add their games to their
// phone's native calendar app (iOS Calendar / Google Calendar both
// understand a plain .ics file with no setup on their end).
//
// Times are emitted with TZID=<tzid> rather than as UTC or floating local
// time, so DST is handled correctly and it stays right even if the ref's
// phone is set to a different timezone than the games are actually in.
// Defaults to America/Denver (Mountain Time) since that's this tool's
// primary user, but each ref can change it in Settings if they ref
// somewhere else — any standard IANA timezone name works.

function pad(n) {
  return String(n).padStart(2, '0');
}

// "YYYY-MM-DD" + "HH:MM" -> "YYYYMMDDTHHMMSS" (no offset — paired with TZID).
function toICSDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-');
  const [hh, mm] = timeStr.split(':');
  return `${y}${m}${d}T${hh}${mm}00`;
}

function escapeText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// Folds long lines per RFC 5545 (75 octets, continuation lines start with a space).
function foldLine(line) {
  if (line.length <= 75) return line;
  let out = '';
  let rest = line;
  while (rest.length > 75) {
    out += rest.slice(0, 75) + '\r\n ';
    rest = rest.slice(75);
  }
  return out + rest;
}

/**
 * events: [{ uid, date, startTime, endTime, summary, location, description }]
 *   date/startTime/endTime are raw "YYYY-MM-DD"/"HH:MM" strings.
 */
function buildICS(events, calendarName, tzid) {
  const zone = tzid || 'America/Denver';
  const d = new Date();
  const now =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//RefLog//Referee Game Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName || 'RefLog Games')}`,
  ];

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}@reflog`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;TZID=${zone}:${toICSDateTime(ev.date, ev.startTime)}`);
    lines.push(`DTEND;TZID=${zone}:${toICSDateTime(ev.date, ev.endTime)}`);
    lines.push(foldLine(`SUMMARY:${escapeText(ev.summary)}`));
    if (ev.location) lines.push(foldLine(`LOCATION:${escapeText(ev.location)}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${escapeText(ev.description)}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildICS };
