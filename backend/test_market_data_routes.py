import unittest

from fastapi import HTTPException

from backend import main


async def _none(*_args, **_kwargs):
    return None


class MarketDataRoutesTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self._market_provider_order = main._market_provider_order
        self._groww_get = main._groww_get
        self._upstox_batch_ltp = main._upstox_batch_ltp
        self._upstox_option_chain = main._upstox_option_chain
        self._upstox_full_quote = main._upstox_full_quote

        main._market_provider_order = lambda: ["groww", "upstox"]
        main._groww_get = _none
        main._upstox_batch_ltp = _none
        main._upstox_option_chain = _none
        main._upstox_full_quote = _none

    def tearDown(self):
        main._market_provider_order = self._market_provider_order
        main._groww_get = self._groww_get
        main._upstox_batch_ltp = self._upstox_batch_ltp
        main._upstox_option_chain = self._upstox_option_chain
        main._upstox_full_quote = self._upstox_full_quote

    async def test_ltp_raises_when_all_providers_fail(self):
        with self.assertRaises(HTTPException) as ctx:
            await main.get_ltp(segment="FNO", exchange_symbols="NSE_NIFTY")

        self.assertEqual(ctx.exception.status_code, 502)

    async def test_option_chain_raises_instead_of_synthetic_default(self):
        with self.assertRaises(HTTPException) as ctx:
            await main.get_option_chain(exchange="NSE", underlying="NIFTY", expiry_date="2026-06-25", allow_mock=False)

        self.assertEqual(ctx.exception.status_code, 502)

    async def test_fno_quote_raises_instead_of_base_underlying_fallback(self):
        with self.assertRaises(HTTPException) as ctx:
            await main.get_fno_quote("NIFTY26JUNFUT", allow_mock=False)

        self.assertEqual(ctx.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
