import json
import requests
from typing import List, Optional
from solana.transaction import Transaction
from solders.pubkey import Pubkey
from .utils import convert_to_transaction
from .types import ActiveBin, GetPositionByUser, StrategyParameters, SwapQuote, LBPair, TokenReserve

API_URL = "http://localhost:3000"

class DLMM:
    session: requests.Session
    pool_address: Pubkey
    rpc: str
    lb_pair: LBPair
    token_X: TokenReserve
    token_Y: TokenReserve

    def __init__(self, public_key: Pubkey, rpc: str) -> None:
        self.pool_address = public_key
        self.rpc = rpc
        session = requests.Session()
        session.headers.update({
            'Content-type': 'application/json', 
            'Accept': 'text/plain',
            'pool': public_key,
            'rpc': rpc
        })
        self.session = session

        try:
            result = session.get(f"{API_URL}/dlmm/create").json()
            self.lb_pair = LBPair(result["lbPair"])
            self.token_X = TokenReserve(result["tokenX"])
            self.token_Y = TokenReserve(result["tokenY"])
        except Exception as e:
            raise Exception(f"Error creating DLMM: {e}")
    
    def get_active_bin(self) -> ActiveBin:
        try:
            result = self.session.get(f"{API_URL}/dlmm/get-active-bin").json()
            active_bin = ActiveBin(result)
            return active_bin
        except Exception as e:
            raise Exception(f"Error getting active bins: {e}")

    def from_price_per_lamport(self, price: float) -> float:
        try:
            data = json.dumps({
                "price": price
            })
            result = self.session.post(f"{API_URL}/dlmm/from-price-per-lamport", data=data).json()
            return float(result["price"])
        except Exception as e:
            raise Exception(f"Error converting price per lamports: {e}")

    def initialize_position_and_add_liquidity_by_strategy(self, position_pub_key: Pubkey, user: Pubkey, x_amount: int, y_amount: int, strategy: StrategyParameters) -> Transaction:
        try:
            data = json.dumps({
                "positionPubKey": str(position_pub_key),
                "userPublicKey": str(user),
                "totalXAmount": x_amount,
                "totalYAmount": y_amount,
                "maxBinId": strategy["max_bin_id"],
                "minBinId": strategy["min_bin_id"],
                "strategyType": str(strategy["strategy_type"])
            })
            result = self.session.post(f"{API_URL}/dlmm/initialize-position-and-add-liquidity-by-strategy", data=data).json()
            transaction = convert_to_transaction(result)
            return transaction
        except Exception as e:
            raise Exception(f"Error initializing position and adding liquidity by strategy: {e}")
    
    def add_liquidity_by_strategy(self, position_pub_key: Pubkey, user: Pubkey, x_amount: int, y_amount: int, strategy: StrategyParameters) -> Transaction:
        try:
            data = json.dumps({
                "positionPubKey": str(position_pub_key),
                "userPublicKey": str(user),
                "totalXAmount": x_amount,
                "totalYAmount": y_amount,
                "maxBinId": strategy["max_bin_id"],
                "minBinId": strategy["min_bin_id"],
                "strategyType": str(strategy["strategy_type"])
            })
            result = self.session.post(f"{API_URL}/dlmm/add-liquidity-by-strategy", data=data).json()
            transaction = convert_to_transaction(result)
            return transaction
        except Exception as e:
            raise Exception(f"Error adding liquidity by strategy: {e}")

    def get_positions_by_user_and_lb_pair(self, user: Pubkey) -> GetPositionByUser:
        try:
            data = json.dumps({
                "userPublicKey": str(user)
            })
            result = self.session.post(f"{API_URL}/dlmm/get-positions-by-user-and-lb-pair", data=data).json()
            return GetPositionByUser(result)
        except Exception as e:
            raise Exception(f"Error getting positions by user and lb pair: {e}")

    # TODO: Add result to transaction object
    def remove_liqidity(self, position_pub_key: Pubkey, user: Pubkey, bin_ids: List[int], bps: List[int], should_claim_and_close: bool) -> List[Transaction]:
        try:
            data = json.dumps({
                "positionPubKey": str(position_pub_key),
                "userPublicKey": str(user),
                "binIds": bin_ids,
                "bps": bps,
                "shouldClaimAndClose": should_claim_and_close
            })
            result = self.session.post(f"{API_URL}/dlmm/remove-liquidity", data=data).json()
            return [Transaction(tx_data) for tx_data in result]if type(result) == list else [Transaction(result)]
        except Exception as e:
            raise Exception(f"Error removing liquidity: {e}")
    
    # TODO: Add type for result
    def get_bin_array_for_swap(self, swap_Y_to_X: bool, count: Optional[int]=4) -> dict:
        try:
            data = json.dumps({
                "swapYToX": swap_Y_to_X,
                "count": count
            })
            result = self.session.post(f"{API_URL}/dlmm/get-bin-array-for-swap", data=data).json()
            return result
        except Exception as e:
            raise Exception(f"Error getting bin array for swap: {e}")

    def swap_quote(self, amount: int, swap_Y_to_X: bool, allowed_slippage: int, binArrays: dict, is_partial_filled: Optional[bool]=False) -> int:
        try:
            data = json.dumps({
                "swapYToX": swap_Y_to_X,
                "amount": amount,
                "allowedSlippage": allowed_slippage,
                "binArrays": binArrays,
                "isPartialFilled": is_partial_filled
            })
            result = self.session.post(f"{API_URL}/dlmm/swap-quote", data=data).json()
            return SwapQuote(result)
        except Exception as e:
            raise Exception(f"Error swapping quote: {e}")
    
    # TODO: Add type for result
    def swap(self, in_token: Pubkey, out_token: Pubkey, in_amount: int, min_out_amount: int, lb_pair: Pubkey,  user: Pubkey, binArrays: List[Pubkey]) -> Transaction:
        try:
            data = json.dumps({
                "inToken": str(in_token),
                "outToken": str(out_token),
                "inAmount": in_amount,
                "minOutAmount": min_out_amount,
                "lbPair": str(lb_pair),
                "userPublicKey": str(user),
                "binArrays": list(map(lambda x: str(x), binArrays))
            })
            result = self.session.post(f"{API_URL}/dlmm/swap", data=data).json()
            tx = convert_to_transaction(result)
            return tx
        except Exception as e:
            raise Exception(f"Error swapping: {e}")


class DLMM_CLIENT:

    @staticmethod
    def create(public_key: Pubkey, rpc: str) -> DLMM:
        return DLMM(public_key, rpc)
    
    @staticmethod
    def create_multiple(public_keys: List[Pubkey], rpc: str) -> List[DLMM]:
        return [DLMM(public_keys, rpc) for public_keys in public_keys]