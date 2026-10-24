import unittest

from money import parse_amount


class ParseAmountTest(unittest.TestCase):
    def test_plain_number(self):
        self.assertEqual(parse_amount("10"), 10)


if __name__ == "__main__":
    unittest.main()
