"""Parsing of amounts typed by users in payment forms."""


def parse_amount(text):
    return round(float(text), 2)
