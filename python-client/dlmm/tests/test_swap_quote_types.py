import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
import requests
from solders.pubkey import Pubkey

import dlmm.dlmm as dlmm_module
from dlmm.types import SwapQuote


FIELDS = [
    ("consumedInAmount", "consumed_in_amount"),
    ("outAmount", "out_amount"),
    ("fee", "fee"),
    ("protocolFee", "protocol_fee"),
    ("minOutAmount", "min_out_amount"),
]


def response():
    # BN fields use hex, while Decimal fields use decimal strings.
    return {
        "consumedInAmount": "64",
        "outAmount": "0f",
        "fee": "01",
        "protocolFee": "00",
        "minOutAmount": "0e",
        "priceImpact": "1.25",
        "binArraysPubkey": [str(Pubkey.default())],
    }


@pytest.mark.parametrize("field,attribute", FIELDS)
@pytest.mark.parametrize(
    "wire,expected",
    [("00", 0), ("01", 1), ("09", 9), ("0a", 10),
     ("0f", 15), ("10", 16), ("64", 100), ("03e8", 1000)],
)
def test_quote_amount_fields_read_hex(field, attribute, wire, expected):
    data = response()
    data.update({name: "01" for name, _ in FIELDS})
    data[field] = wire
    assert getattr(SwapQuote(data), attribute) == expected


def test_quote_preserves_decimal_price_impact_and_public_keys():
    quote = SwapQuote(response())
    assert quote.consumed_in_amount == 100
    assert quote.out_amount == 15
    assert quote.fee == 1
    assert quote.protocol_fee == 0
    assert quote.min_out_amount == 14
    assert quote.price_impact == 1.25
    assert quote.bin_arrays_pubkey == [Pubkey.default()]


def test_swap_quote_method_parses_actual_http_response(monkeypatch):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append((self.path, json.loads(self.rfile.read(
                int(self.headers["Content-Length"])
            ))))
            payload = json.dumps(response()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    monkeypatch.setattr(dlmm_module, "API_URL", f"http://127.0.0.1:{server.server_port}")
    client = dlmm_module.DLMM.__new__(dlmm_module.DLMM)
    session = requests.Session()
    session.headers["Content-Type"] = "application/json"
    client._DLMM__session = session
    try:
        quote = client.swap_quote(100, False, 10, [])
        assert quote.consumed_in_amount == 100
        assert quote.out_amount == 15
        assert quote.min_out_amount == 14
        assert received == [("/dlmm/swap-quote", {
            "swapYToX": False, "amount": 100, "allowedSlippage": 10,
            "binArrays": [], "isPartialFilled": False,
        })]
    finally:
        session.close()
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)
