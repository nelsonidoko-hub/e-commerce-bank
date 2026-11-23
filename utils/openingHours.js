// Opening hours: is the shop open right now, and when does it next open?
//
// This exact file is used in BOTH projects (backend utils/ and frontend utils/),
// so the storefront badge and the server's "no orders while closed" check can
// never disagree. It has no imports, so it works in both places unchanged.
//
// `hours` is the "hours" section of the store settings:
//   { enabled, timezone, whenClosed, monOpen: '09:00', monClose: '21:00', monClosed: false, tueOpen: ... }

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] // the order JavaScript counts days
export const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] // the order people read them
export const DAY_NAMES = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
}

const DEFAULT_TIMEZONE = 'Africa/Lagos'
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

const toMinutes = (time) => {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

// "21:00" -> "9:00 PM"
export function formatTime(time) {
  if (!TIME.test(time || '')) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

// One day's setting, or null if that day is closed or its times are unusable.
// A day whose opening and closing time are the same counts as closed.
function dayWindow(hours, day) {
  if (hours[`${day}Closed`]) return null
  const open = hours[`${day}Open`]
  const close = hours[`${day}Close`]
  if (!TIME.test(open || '') || !TIME.test(close || '') || open === close) return null
  return { open, close, o: toMinutes(open), c: toMinutes(close) }
}

function validTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    return DEFAULT_TIMEZONE
  }
}

// The weekday and minutes-since-midnight right now, in the shop's own time zone
function shopClock(timezone, now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (type) => parts.find((p) => p.type === type)?.value
  return {
    day: get('weekday').toLowerCase().slice(0, 3),
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  }
}

const previousDay = (day) => DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7]

// If open right now, returns the closing time ("21:00"), otherwise null
function closingTimeNow(hours, day, minutes) {
  const today = dayWindow(hours, day)
  if (today) {
    if (today.o < today.c && minutes >= today.o && minutes < today.c) return today.close
    // opened today and runs past midnight (e.g. 18:00 to 02:00)
    if (today.o > today.c && minutes >= today.o) return today.close
  }
  // opened yesterday and is still running this morning
  const yesterday = dayWindow(hours, previousDay(day))
  if (yesterday && yesterday.o > yesterday.c && minutes < yesterday.c) return yesterday.close
  return null
}

// The next time the shop opens, looking up to a week ahead
function nextOpening(hours, day, minutes) {
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = DAY_KEYS[(DAY_KEYS.indexOf(day) + offset) % 7]
    const window = dayWindow(hours, candidate)
    if (!window) continue
    if (offset === 0 && window.o <= minutes) continue // today's opening time has already passed
    return { offset, day: candidate, time: window.open }
  }
  return null
}

function describeOpening(next) {
  if (!next) return ''
  const time = formatTime(next.time)
  if (next.offset === 0) return `today at ${time}`
  if (next.offset === 1) return `tomorrow at ${time}`
  return `${DAY_NAMES[next.day]} at ${time}`
}

// What the shop is doing right now.
//   { enabled: false, open: true }  -> the shop doesn't use opening hours, so it is always open
//   { enabled: true, open, text, opensText }
export function getOpenStatus(hours, now = new Date()) {
  if (!hours || !hours.enabled) return { enabled: false, open: true, text: '', opensText: '' }

  const { day, minutes } = shopClock(validTimezone(hours.timezone), now)

  const closes = closingTimeNow(hours, day, minutes)
  if (closes) {
    return {
      enabled: true,
      open: true,
      text: `Open now · until ${formatTime(closes)}`,
      opensText: '',
    }
  }

  const opensText = describeOpening(nextOpening(hours, day, minutes))
  return {
    enabled: true,
    open: false,
    text: opensText ? `Closed · opens ${opensText}` : 'Closed',
    opensText,
  }
}

// One day's hours as text, for listing them: "9:00 AM – 9:00 PM" or "Closed"
export function describeDay(hours, day) {
  const window = dayWindow(hours, day)
  return window ? `${formatTime(window.open)} – ${formatTime(window.close)}` : 'Closed'
}