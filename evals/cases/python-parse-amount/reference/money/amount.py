"""Parsing of amounts typed by users in payment forms."""

import re
from decimal import ROUND_HALF_UP, Decimal

_AMOUNT = re.compile(r"^[$₡]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$")


def parse_amount(text):
    cleaned = str(text).strip()
    if not _AMOUNT.match(cleaned):
        raise ValueError(f"invalid amount: {text!r}")
    number = cleaned.lstrip("$₡").replace(",", "")
    return Decimal(number).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
