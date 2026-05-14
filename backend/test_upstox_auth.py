import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from backend import main


class UpstoxAuthHelpersTest(unittest.TestCase):
    def tearDown(self):
        main._upstox_runtime_access_token = main.UPSTOX_ACCESS_TOKEN
        main._upstox_token_meta = {}
        main._market_data_provider_preference = main.MARKET_DATA_PROVIDER

    def test_next_token_expiry_uses_upstox_330am_cutoff(self):
        ist = ZoneInfo("Asia/Kolkata")

        before_cutoff = main._upstox_next_token_expiry(datetime(2026, 5, 10, 2, 15, tzinfo=ist))
        after_cutoff = main._upstox_next_token_expiry(datetime(2026, 5, 10, 9, 15, tzinfo=ist))

        self.assertEqual(before_cutoff.isoformat(), "2026-05-10T03:30:00+05:30")
        self.assertEqual(after_cutoff.isoformat(), "2026-05-11T03:30:00+05:30")

    def test_runtime_token_is_cleaned_persisted_and_reloaded(self):
        with tempfile.TemporaryDirectory() as tmp:
            token_file = str(Path(tmp) / "token.json")
            expires_at = "2027-05-11T03:30:00+05:30"

            main._set_upstox_runtime_token(
                "Bearer live-token",
                expires_at=expires_at,
                profile={"user_id": "AB1234"},
                token_file=token_file,
            )

            saved = json.loads(Path(token_file).read_text(encoding="utf-8"))
            self.assertEqual(saved["access_token"], "live-token")
            self.assertEqual(saved["expires_at"], expires_at)
            self.assertEqual(main._get_upstox_access_token(token_file=token_file), "live-token")

            main._upstox_runtime_access_token = ""
            main._upstox_token_meta = {}
            self.assertEqual(main._get_upstox_access_token(token_file=token_file), "live-token")
            self.assertTrue(main._is_upstox_configured())

    def test_provider_preference_accepts_groww_and_upstox_aliases(self):
        self.assertEqual(main._set_market_provider_preference("upstoxx"), "upstox")
        self.assertEqual(main._market_provider_order(), ["upstox", "groww"])

        self.assertEqual(main._set_market_provider_preference("grow"), "groww")
        self.assertEqual(main._market_provider_order(), ["groww", "upstox"])

    def test_provider_preference_rejects_unknown_provider(self):
        with self.assertRaises(ValueError):
            main._set_market_provider_preference("zerodha")


if __name__ == "__main__":
    unittest.main()
