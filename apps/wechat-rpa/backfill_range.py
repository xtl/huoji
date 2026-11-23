"""Conservative range selection from ordered, minute-precision chat separators."""
from datetime import timedelta
from history_dates import attach_publication_times, divider_bounds, ordered_dividers, stronger_time

MINUTE = timedelta(minutes=1)


def _event_key(event):
    kind, value = event
    return kind, value["messageId"] if kind == "message" else value


def _overlap(older, newer):
    """Join consecutive screens only at an unambiguous shared sequence."""
    limit = min(len(older), len(newer))
    left = [_event_key(event) for event in older]
    right = [_event_key(event) for event in newer]
    for size in range(limit, 0, -1):
        shared = right[:size]
        if left[-size:] != shared:
            continue
        # Unreadable rows and a lone repeatable quote cannot locate a screen.
        if any(kind == "unknown" for kind, _ in shared):
            continue
        messages = {key for kind, key in shared if kind == "message"}
        if not any(kind == "date" for kind, _ in shared) and len(messages) < 2:
            continue
        if any(left[i:i + size] == shared for i in range(len(left) - size)):
            continue
        if any(right[i:i + size] == shared for i in range(1, len(right) - size + 1)):
            continue
        return size
    return 0


class DateRangeScan:
    def __init__(self, start, end):
        self.start = start
        self.end = end
        self.events = []
        self.preflight = []
        self.uncertain = set()
        self.classified = set()
        self.eligible = set()
        self.saved_times = {}
        self.time_updates = []
        self.reached = False

    def read(self, page, *, observed_by_end=False, allow_stop=True):
        """Return newly proven in-range bubbles; their own sentAt remains unknown."""
        self.time_updates = []
        # Date evidence must advance monotonically on a single screen. A bad
        # reading cannot certify either membership or the end of the scan.
        ids = {value["messageId"] for kind, value in page if kind == "message"}
        self.uncertain.update(ids - self.classified)
        if not ordered_dividers(page):
            self.events = []
            return []
        # At opposite crop edges a clipped row can vanish from one screen or
        # become complete on the next. Only replace those outer gaps when the
        # interior of the overlap is independently and uniquely identified.
        older = page.copy()
        while older and older[-1][0] == "unknown":
            older.pop()
        tail = [("upper", self.end)] if observed_by_end else []
        joined = page + tail
        # A busy chat may have shifted while another selected chat was being
        # processed. Retain the original pre-cutoff frame as an alternative
        # overlap until we regain its position in the currently visible log.
        candidates = [self.events]
        if self.preflight and not any(kind == "upper" for kind, _ in self.events):
            candidates.insert(0, self.preflight)
        current_length = len(page)
        for newer in candidates:
            first = next((i for i, event in enumerate(newer) if event[0] != "unknown"), len(newer))
            newer = newer[first:]
            size = _overlap(older, newer)
            if size:
                joined = older + tail + newer[size:]
                current_length = len(older)
                break
        if not ordered_dividers(joined):
            joined = page + ([("upper", self.end)] if observed_by_end else [])
            current_length = len(page)
        self.events = joined
        attach_publication_times(joined, same_screen=False)
        if observed_by_end and not self.preflight:
            self.preflight = page + tail
        upper = None
        observed_upper = None
        latest_bounds = []
        crossed = False
        for index in range(len(joined) - 1, -1, -1):
            kind, value = joined[index]
            bounds = divider_bounds(kind, value)
            if bounds is not None:
                first, last = bounds
                if upper is not None and first > upper:
                    self.events = []
                    return []
                upper = min(last + MINUTE, upper) if upper is not None else last + MINUTE
            elif kind == "upper":
                observed_upper = value
                upper = min(value, upper) if upper is not None else value
            elif kind == "unknown":
                upper = observed_upper
            if index < current_length and bounds is not None and upper < self.start:
                crossed = True
            latest_bounds.append(upper)
        lower = None
        chosen = {}
        refinements = {}
        classified = set()
        for (kind, value), upper in zip(joined, reversed(latest_bounds)):
            bounds = divider_bounds(kind, value)
            if bounds is not None:
                lower = bounds[0] if lower is None else max(bounds[0], lower)
            elif kind == "unknown":
                lower = None
            if lower is not None and upper is not None and lower > upper:
                self.events = []
                return []
            if kind == "message":
                key = value["messageId"]
                # Never substitute a screen observation or separator for sentAt.
                if lower is not None and lower >= self.start and upper is not None and upper <= self.end:
                    classified.add(key)
                    if key not in self.eligible:
                        chosen[key] = value
                    else:
                        first_observed, saved = self.saved_times[key]
                        if value["observedAt"] == first_observed and stronger_time(saved, value.get("publishedTime"), first_observed):
                            refinements[key] = value
                elif (upper is not None and upper < self.start) or (lower is not None and lower > self.end):
                    classified.add(key)
        self.classified.update(classified)
        self.uncertain.difference_update(classified)
        self.eligible.update(chosen)
        self.time_updates = list(refinements.values())
        for key, message in (*chosen.items(), *refinements.items()):
            self.saved_times[key] = (message["observedAt"], message.get("publishedTime"))
        self.reached |= allow_stop and crossed
        return list(chosen.values())
