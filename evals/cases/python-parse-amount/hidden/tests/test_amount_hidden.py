import unittest
from decimal import Decimal

from money import parse_amount


class HiddenParseAmountTest(unittest.TestCase):
    def test_returns_decimal_with_two_places(self):
        value = parse_amount("1250.5")
        self.assertIsInstance(value, Decimal)
        self.assertEqual(value, Decimal("1250.50"))
        self.assertEqual(value.as_tuple().exponent, -2)

    def test_rounds_half_up(self):
        self.assertEqual(parse_amount("2.675"), Decimal("2.68"))
        self.assertEqual(parse_amount("0.125"), Decimal("0.13"))

    def test_symbols_separators_and_spaces(self):
        for text in ["1,250.50", " $1,250.50 ", "₡1,250.50", "1250.50"]:
            self.assertEqual(parse_amount(text), Decimal("1250.50"), text)
        self.assertEqual(parse_amount("₡3,000"), Decimal("3000.00"))

    def test_rejects_bad_input(self):
        for text in ["", "   ", "-5", "$-5", "abc", "12a", "1,2,3", "12.3.4", "$", "1,25.00"]:
            with self.assertRaises(ValueError, msg=text):
                parse_amount(text)


if __name__ == "__main__":
    unittest.main()
