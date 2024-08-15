import requests
from typing import List, Optional, Union
from solana.transaction import Transaction
from solders.pubkey import Pubkey
from .utils import convert_to_transaction
from .types import ActiveBin, GetPositionByUser, StrategyParameters, SwapQuote, LBPair, TokenReserve

API_URL = "http://localhost:3000"

class DLMM_CLIENT:
    pool_address: Union[str, List[str]]
    rpc: str
    lb_pair: LBPair
    token_X: TokenReserve
    token_Y: TokenReserve

    def __init__(self, public_keys: Union[str, List[str]], rpc: str) -> None:
        self.pool_address = public_keys
        self.rpc = rpc

        if isinstance(public_keys, str):
            try:
                result = requests.post(f"{API_URL}/dlmm/create", data={"publicKey": public_keys, "rpc": rpc}).json()
                self.lb_pair = LBPair(result["lbPair"])
                self.token_X = TokenReserve(result["tokenX"])
                self.token_Y = TokenReserve(result["tokenY"])
            except Exception as e:
                raise Exception(f"Error creating DLMM: {e}")
        elif isinstance(public_keys, list):
            try:
                result = requests.post(f"{API_URL}/dlmm/create-multiple", data={"publicKeys": public_keys, "rpc": rpc}).json()
                self.lb_pair = LBPair(result["lbPair"])
                self.token_X = TokenReserve(result["tokenX"])
                self.token_Y = TokenReserve(result["tokenY"])
            except Exception as e:
                raise Exception(f"Error creating DLMM: {e}")
    
    def get_active_bin(self) -> ActiveBin:
        try:
            result = requests.post(f"{API_URL}/dlmm/get-active-bin", data={"publicKey": self.pool_address}).json()
            active_bin = ActiveBin(result)
            return active_bin
        except Exception as e:
            raise Exception(f"Error getting active bins: {e}")

    def from_price_per_lamport(self, price: float) -> float:
        try:
            data = {
                "price": price,
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/from-price-per-lamport", data=data).json()
            return float(result["price"])
        except Exception as e:
            raise Exception(f"Error converting price per lamports: {e}")

    def initialize_position_and_add_liquidity_by_strategy(self, position_pub_key: Pubkey, user: Pubkey, x_amount: int, y_amount: int, strategy: StrategyParameters) -> Transaction:
        try:
            data = {
                "positionPubKey": position_pub_key,
                "userPublicKey": user,
                "totalXAmount": x_amount,
                "totalYAmount": y_amount,
                "maxBinId": strategy["max_bin_id"],
                "minBinId": strategy["min_bin_id"],
                "strategyType": strategy["strategy_type"],
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/initialize-position-and-add-liquidity-by-strategy", data=data).json()
            transaction = convert_to_transaction(result)
            return transaction
        except Exception as e:
            raise Exception(f"Error initializing position and adding liquidity by strategy: {e}")
    
    def add_liquidity_by_strategy(self, position_pub_key: Pubkey, user: Pubkey, x_amount: int, y_amount: int, strategy: StrategyParameters) -> Transaction:
        try:
            data = {
                "positionPubKey": position_pub_key,
                "userPublicKey": user,
                "totalXAmount": x_amount,
                "totalYAmount": y_amount,
                "maxBinId": strategy["max_bin_id"],
                "minBinId": strategy["min_bin_id"],
                "strategyType": strategy["strategy_type"],
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/add-liquidity-by-strategy", data=data).json()
            transaction = convert_to_transaction(result)
            return transaction
        except Exception as e:
            raise Exception(f"Error adding liquidity by strategy: {e}")

    def get_positions_by_user_and_lb_pair(self, user: str) -> GetPositionByUser:
        try:
            data = {
                "userPublicKey": user,
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/get-positions-by-user-and-lb-pair", data=data).json()
            clean_result = GetPositionByUser(result)
            return clean_result
        except Exception as e:
            raise Exception(f"Error getting positions by user and lb pair: {e}")

    # TODO: Add result to transaction object
    def remove_liqidity(self, position_pub_key: str, user: str, bin_ids: List[int], bps: List[int], should_claim_and_close: bool) -> List[Transaction]:
        try:
            data = {
                "positionPubKey": position_pub_key,
                "userPublicKey": user,
                "binIds": bin_ids,
                "bps": bps,
                "shouldClaimAndClose": should_claim_and_close,
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/remove-liquidity", data=data).json()
            return result
        except Exception as e:
            raise Exception(f"Error removing liquidity: {e}")
    
    # TODO: Add type for result
    def get_bin_array_for_swap(self, swap_Y_to_X: bool, count: Optional[int]=4) -> List[int]:
        try:
            data = {
                "swapYToX": swap_Y_to_X,
                "count": count,
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/get-bin-array-for-swap", data=data).json()
            return result
        except Exception as e:
            raise Exception(f"Error getting bin array for swap: {e}")

    def swap_quote(self, swap_Y_to_X: bool, amount: int, allowed_slippage: int, binArrays: List[int], is_partial_filled: Optional[bool]=False) -> int:
        try:
            data = {
                "swapYToX": swap_Y_to_X,
                "amount": amount,
                "allowedSlippage": allowed_slippage,
                "binArrays": binArrays,
                "isPartialFilled": is_partial_filled,
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/swap-quote", data=data).json()
            return SwapQuote(result)
        except Exception as e:
            raise Exception(f"Error swapping quote: {e}")
    
    def swap(self, in_token: str, out_token: str, in_amount: int, min_out_amount: int, lb_pair: str,  user: str, binArrays: List[str]):
        try:
            data = {
                "inToken": in_token,
                "outToken": out_token,
                "inAmount": in_amount,
                "minOutAmount": min_out_amount,
                "lbPair": lb_pair,
                "userPublicKey": user,
                "binArrays": binArrays,
                "publicKey": self.pool_address
            }
            result = requests.post(f"{API_URL}/dlmm/swap", data=data).json()
            return result
        except Exception as e:
            raise Exception(f"Error swapping: {e}")
