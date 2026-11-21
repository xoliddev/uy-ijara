"""Tashkent time with whole numbers only (UTC+5 all year: Uzbekistan has no daylight saving time since 1992).

Times are UTC milliseconds. Calendar dates come from Howard Hinnant's days -> civil algorithm, so the Python
server and the JS demo agree on "tomorrow 10:00" on any day, also across month ends and New Year.
"""

from __future__ import annotations

TZ_OFFSET_MS = 5 * 3_600_000
DAY_MS = 86_400_000
HOUR_MS = 3_600_000
MIN_MS = 60_000


def local_day(ms: int) -> int:
    """Days since 1970-01-01 in Tashkent."""
    return (ms + TZ_OFFSET_MS) // DAY_MS


def local_minute(ms: int) -> int:
    """Minute of the day in Tashkent (0..1439)."""
    return ((ms + TZ_OFFSET_MS) % DAY_MS) // MIN_MS


def weekday(day: int) -> int:
    """0 = Monday ... 6 = Sunday (1970-01-01 was a Thursday)."""
    return (day + 3) % 7


def civil(day: int) -> tuple[int, int, int]:
    """Days since epoch -> (year, month 1..12, day 1..31)."""
    z = day + 719_468
    era = z // 146_097
    doe = z - era * 146_097
    yoe = (doe - doe // 1460 + doe // 36_524 - doe // 146_096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    return (y + 1 if m <= 2 else y), m, d


def at_local(day: int, minute: int) -> int:
    """Tashkent day number + minute of day -> UTC milliseconds."""
    return day * DAY_MS + minute * MIN_MS - TZ_OFFSET_MS


def hhmm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"
