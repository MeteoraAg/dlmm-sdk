import json
import requests
from typing import Dict, List, Optional
from solana.transaction import Transaction
from solders.pubkey import Pubkey
from .utils import convert_to_transaction
from .types import ActiveBin, FeeInfo, GetBins, GetPositionByUser, Position, PositionInfo, StrategyParameters, SwapQuote, LBPair, TokenReserve, DlmmHttpError as HTTPError

API_URL = "http://localhost:3000"

class DLMM:
    __session: requests.Session
    pool_address: Pubkey
    rpc: str
    lb_pair: LBPair
    token_X: TokenReserve
    token_Y: TokenReserve

    def __init__(self, public_key: Pubkey, rpc: str) -> None:
        if type(public_key) != Pubkey:
            raise TypeError("public_key must be of type `solders.pubkey.Pubkey`")
        
        if type(rpc) != str:
            raise TypeError("rpc must be of type `str`")
        
        self.pool_address = public_key
        self.rpc = rpc
        session = requests.Session()
        session.headers.update({
            'Content-type': 'application/json', 
            'Accept': 'text/plain',
            'pool': str(public_key),
            'rpc': rpc
        })
        self.__session = session

        try:
            result = session.get(f"{API_URL}/dlmm/create").json()
            self.lb_pair = LBPair(result["lbPair"])
            self.token_X = TokenReserve(result["tokenX"])
            self.token_Y = TokenReserve(result["tokenY"])
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error creating DLMM: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_active_bin(self) -> ActiveBin:
        try:
            result = self.__session.get(f"{API_URL}/dlmm/get-active-bin").json()
            active_bin = ActiveBin(result)
            return active_bin
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting active bins: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    def from_price_per_lamport(self, price: float) -> float:
        if type(price) != float:
            raise TypeError("price must be of type `float`")
        
        try:
            data = json.dumps({
                "price": price
            })
            result = self.__session.post(f"{API_URL}/dlmm/from-price-per-lamport", data=data).json()
            return float(result["price"])
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error converting price per lamports: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def to_price_per_lamport(self, price: float) -> float:
        if type(price) != float:
            raise TypeError("price must be of type `float`")
        
        try:
            data = json.dumps({
                "price": price
            })
            result = self.__session.post(f"{API_URL}/dlmm/to-price-per-lamport", data=data).json()
            return float(result["price"])
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error converting price per lamports: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    def initialize_position_and_add_liquidity_by_strategy(self, position_pub_key: Pubkey, user: Pubkey, x_amount: int, y_amount: int, strategy: StrategyParameters) -> Transaction:
        if type(position_pub_key) != Pubkey:
            raise TypeError("position_pub_key must be of type `solders.pubkey.Pubkey`")
        
        if type(user) != Pubkey:
            raise TypeError("user must be of type `solders.pubkey.Pubkey`")
        
        if type(x_amount) != int:
            raise TypeError("x_amount must be of type `int`")
        
        if type(y_amount) != int:
            raise TypeError("y_amount must be of type `int`")
        
        if isinstance(strategy, dict) == False:
            raise TypeError("strategy must be of type `dict`")
        else:
            if strategy.get("max_bin_id") is None:
                raise ValueError("max_bin_id is required in strategy")
            
            if strategy.get("min_bin_id") is None:
                raise ValueError("min_bin_id is required in strategy")
            
            if strategy.get("strategy_type") is None:
                raise ValueError("strategy_type is required in strategy")
        
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
            result = self.__session.post(f"{API_URL}/dlmm/initialize-position-and-add-liquidity-by-strategy", data=data).json()
            transaction = convert_to_transaction(result)
            return transaction
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error initializing position and adding liquidity by strategy: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def add_liquidity_by_strategy(self, position_pub_key: Pubkey, user: Pubkey, x_amount: int, y_amount: int, strategy: StrategyParameters) -> Transaction:
        if type(position_pub_key) != Pubkey:
            raise TypeError("position_pub_key must be of type `solders.pubkey.Pubkey`")
        
        if type(user) != Pubkey:
            raise TypeError("user must be of type `solders.pubkey.Pubkey`")
        
        if type(x_amount) != int:
            raise TypeError("x_amount must be of type `int`")
        
        if type(y_amount) != int:
            raise TypeError("y_amount must be of type `int`")
        
        if isinstance(strategy, dict) == False:
            raise TypeError("strategy must be of type `dict`")
        else:
            if strategy.get("max_bin_id") is None:
                raise ValueError("max_bin_id is required in strategy")
            
            if strategy.get("min_bin_id") is None:
                raise ValueError("min_bin_id is required in strategy")
            
            if strategy.get("strategy_type") is None:
                raise ValueError("strategy_type is required in strategy")
        
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
            result = self.__session.post(f"{API_URL}/dlmm/add-liquidity-by-strategy", data=data).json()
            transaction = convert_to_transaction(result)
            return transaction
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error adding liquidity by strategy: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    def get_positions_by_user_and_lb_pair(self, user: Pubkey) -> GetPositionByUser:
        if type(user) != Pubkey:
            raise TypeError("user must be of type `solders.pubkey.Pubkey`")
        
        try:
            data = json.dumps({
                "userPublicKey": str(user)
            })
            result = self.__session.post(f"{API_URL}/dlmm/get-positions-by-user-and-lb-pair", data=data).json()
            return GetPositionByUser(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting positions by user and lb pair: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    def remove_liqidity(self, position_pub_key: Pubkey, user: Pubkey, bin_ids: List[int], bps: int, should_claim_and_close: bool) -> List[Transaction]:
        if type(position_pub_key) != Pubkey:
            raise TypeError("position_pub_key must be of type `solders.pubkey.Pubkey`")
        
        if type(user) != Pubkey:
            raise TypeError("user must be of type `solders.pubkey.Pubkey`")
        
        if type(bin_ids) != list:
            raise TypeError("bin_ids must be of type `list`")
        
        if type(bps) != int:
            raise TypeError("bps must be of type `int`")
        
        if isinstance(should_claim_and_close, bool) == False:
            raise TypeError("should_claim_and_close must be of type `bool`")

        try:
            data = json.dumps({
                "positionPubKey": str(position_pub_key),
                "userPublicKey": str(user),
                "binIds": bin_ids,
                "bps": bps,
                "shouldClaimAndClose": should_claim_and_close
            })
            result = self.__session.post(f"{API_URL}/dlmm/remove-liquidity", data=data).json()
            return [convert_to_transaction(tx_data) for tx_data in result] if type(result) == list else [convert_to_transaction(result)]
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error removing liquidity: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def close_position(self, owner: Pubkey, position: Position) -> Transaction:
        if type(owner) != Pubkey:
            raise TypeError("owner must be of type `solders.pubkey.Pubkey`")
        
        if type(position) != Position:
            raise TypeError("position must be of type `dlmm.types.Position`")
        
        try:
            data = json.dumps({
                "owner": str(owner),
                "position": position.to_json()
            })
            result = self.__session.post(f"{API_URL}/dlmm/close-position", data=data).json()
            return convert_to_transaction(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error closing position: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    
    # TODO: Add type for result
    def get_bin_array_for_swap(self, swap_Y_to_X: bool, count: Optional[int]=4) -> List[dict]:
        if isinstance(swap_Y_to_X, bool) == False:
            raise TypeError("swap_Y_to_X must be of type `bool`")
        
        if count is not None and type(count) != int:
            raise TypeError("count must be of type `int`")

        try:
            data = json.dumps({
                "swapYToX": swap_Y_to_X,
                "count": count
            })
            result = self.__session.post(f"{API_URL}/dlmm/get-bin-array-for-swap", data=data).json()
            return result
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting bin array for swap: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    def swap_quote(self, amount: int, swap_Y_to_X: bool, allowed_slippage: int, binArrays: List[dict], is_partial_filled: Optional[bool]=False) -> SwapQuote:
        if type(amount) != int:
            raise TypeError("amount must be of type `int`")
        
        if isinstance(swap_Y_to_X, bool) == False:
            raise TypeError("swap_Y_to_X must be of type `bool`")
        
        if type(allowed_slippage) != int:
            raise TypeError("allowed_slippage must be of type `int`")
        
        if type(binArrays) != list:
            raise TypeError("binArrays must be of type `dict`")
        
        if is_partial_filled is not None and isinstance(is_partial_filled, bool) == False:
            raise TypeError("is_partial_filled must be of type `bool`")
        
        try:
            data = json.dumps({
                "swapYToX": swap_Y_to_X,
                "amount": amount,
                "allowedSlippage": allowed_slippage,
                "binArrays": binArrays,
                "isPartialFilled": is_partial_filled
            })
            result = self.__session.post(f"{API_URL}/dlmm/swap-quote", data=data).json()
            return SwapQuote(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error swapping quote: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def swap(self, in_token: Pubkey, out_token: Pubkey, in_amount: int, min_out_amount: int, lb_pair: Pubkey,  user: Pubkey, binArrays: List[Pubkey]) -> Transaction:
        if type(in_token) != Pubkey:
            raise TypeError("in_token must be of type `solders.pubkey.Pubkey`")
        
        if type(out_token) != Pubkey:
            raise TypeError("out_token must be of type `solders.pubkey.Pubkey`")
        
        if type(in_amount) != int:
            raise TypeError("in_amount must be of type `int`")
        
        if type(min_out_amount) != int:
            raise TypeError("min_out_amount must be of type `int`")
        
        if type(lb_pair) != Pubkey:
            raise TypeError("lb_pair must be of type `solders.pubkey.Pubkey`")
        
        if type(user) != Pubkey:
            raise TypeError("user must be of type `solders.pubkey.Pubkey`")
        
        if type(binArrays) != list:
            raise TypeError("binArrays must be of type `list`")
        
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
            result = self.__session.post(f"{API_URL}/dlmm/swap", data=data).json()
            return convert_to_transaction(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error swapping: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

    def refetch_states(self) -> None:
        try:
            result = self.__session.get(f"{API_URL}/dlmm/refetch-states")
            return None
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error refetching states: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    # TODO: Add type for result
    def get_bin_arrays(self) -> dict:
        try:
            result = self.__session.get(f"{API_URL}/dlmm/get-bin-arrays").json()
            return result
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting bin arrays: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_fee_info(self) -> FeeInfo:
        try:
            result = self.__session.get(f"{API_URL}/dlmm/get-fee-info").json()
            return FeeInfo(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting fee info: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_dynamic_fee(self) -> float:
        try:
            result = self.__session.get(f"{API_URL}/dlmm/get-dynamic-fee").json()
            return float(result['fee'])
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting dynamic fee: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_bin_id_from_price(self, price: float, min: bool) -> int:
        if type(price) != float:
            raise TypeError("price must be of type `float`")

        if isinstance(min, bool) == False:
            raise TypeError("min must be of type `bool`")
        
        try:
            data = json.dumps({
                "price": price,
                "min": min
            })
            result = self.__session.post(f"{API_URL}/dlmm/get-bin-id-from-price", data=data).json()
            return int(result['binId'])
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting bin id from price: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_bins_around_active_bin(self, number_of_bins_to_left: int, number_of_bins_to_right: int) -> GetBins:
        if type(number_of_bins_to_left) != int:
            raise TypeError("number_of_bins_to_left must be of type `int`")
        
        if type(number_of_bins_to_right) != int:
            raise TypeError("number_of_bins_to_right must be of type `int`")
        
        try:
            data = json.dumps({
                "numberOfBinsToTheLeft": number_of_bins_to_left,
                "numberOfBinsToTheRight": number_of_bins_to_right
            })
            result = self.__session.post(f"{API_URL}/dlmm/get-bins-around-active-bin", data=data).json()
            return GetBins(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting bins around active bin: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_bins_between_min_and_max_price(self, min_price: float, max_price: float) -> GetBins:
        if type(min_price) != float:
            raise TypeError("min_price must be of type `float`")
        
        if type(max_price) != float:
            raise TypeError("max_price must be of type `float`")
        
        try:
            data = json.dumps({
                "minPrice": min_price,
                "maxPrice": max_price
            })
            result = self.__session.post(f"{API_URL}/dlmm/get-bins-between-min-and-max-price", data=data).json()
            return GetBins(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting bins between min and max price: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def get_bins_between_lower_and_upper_bound(self, lower_bound: int, upper_bound: int) -> GetBins:
        if type(lower_bound) != int:
            raise TypeError("lower_bound must be of type `int`")
        
        if type(upper_bound) != int:
            raise TypeError("upper_bound must be of type `int`")
        
        try:
            data = json.dumps({
                "lowerBound": lower_bound,
                "upperBound": upper_bound
            })
            result = self.__session.post(f"{API_URL}/dlmm/get-bins-between-lower-and-upper-bound", data=data).json()
            return GetBins(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting bins between lower and upper bound: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def claim_LM_reward(self, owner: Pubkey, position: Position) -> Transaction:
        if type(owner) != Pubkey:
            raise TypeError("owner must be of type `solders.pubkey.Pubkey`")
        
        try:
            data = json.dumps({
                "owner": str(owner),
                "position": position.to_json()
            })
            result = self.__session.post(f"{API_URL}/dlmm/claim-lm-reward", data=data).json()
            return convert_to_transaction(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error claiming LM rewards: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def claim_all_LM_reards(self, owner: Pubkey, positions: List[Position]) -> List[Transaction]:
        if type(owner) != Pubkey:
            raise TypeError("owner must be of type `solders.pubkey.Pubkey`")
        
        if type(positions) != list:
            raise TypeError("positions must be of type `list`")
        
        try:
            data = json.dumps({
                "owner": str(owner),
                "positions": [position.to_json() for position in positions]
            })
            result = self.__session.post(f"{API_URL}/dlmm/claim-all-lm-rewards", data=data).json()
            return [convert_to_transaction(tx) for tx in result]
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error claiming all LM rewards: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def claim_swap_fee(self, owner: Pubkey, position: Position) -> Transaction:
        if type(owner) != Pubkey:
            raise TypeError("owner must be of type `solders.pubkey.Pubkey`")
        
        if type(position) != Position:
            raise TypeError("position must be of type `dlmm.types.Position`")
        
        try:
            data = json.dumps({
                "owner": str(owner),
                "position": position.to_json()
            })
            result = self.__session.post(f"{API_URL}/dlmm/claim-swap-fee", data=data).json()
            return convert_to_transaction(result)
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error claiming swap fee: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def claim_all_swap_fees(self, owner: Pubkey, positions: List[Position]) -> List[Transaction]:
        if type(owner) != Pubkey:
            raise TypeError("owner must be of type `solders.pubkey.Pubkey`")
        
        if type(positions) != list:
            raise TypeError("positions must be of type `list`")
        
        try:
            data = json.dumps({
                "owner": str(owner),
                "positions": [position.to_json() for position in positions]
            })
            result = self.__session.post(f"{API_URL}/dlmm/claim-all-swap-fee", data=data).json()
            return [convert_to_transaction(tx) for tx in result]
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error claiming all swap fees: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")
    
    def claim_all_rewards(self, owner: Pubkey, positions: List[Position]) -> List[Transaction]:
        if type(owner) != Pubkey:
            raise TypeError("owner must be of type `solders.pubkey.Pubkey`")
        
        if type(positions) != list:
            raise TypeError("positions must be of type `list`")
        
        try:
            data = json.dumps({
                "owner": str(owner),
                "positions": [position.to_json() for position in positions]
            })
            result = self.__session.post(f"{API_URL}/dlmm/claim-all-rewards", data=data).json()
            return [convert_to_transaction(tx) for tx in result]
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error claiming all rewards: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")

class DLMM_CLIENT:

    @staticmethod
    def create(public_key: Pubkey, rpc: str) -> DLMM:
        return DLMM(public_key, rpc)
    
    @staticmethod
    def create_multiple(public_keys: List[Pubkey], rpc: str) -> List[DLMM]:
        if type(public_keys) != list:
            raise TypeError("public_keys must be of type `list`")
        
        return [DLMM(public_keys, rpc) for public_keys in public_keys]
    
    @staticmethod
    def get_all_lb_pair_positions_by_user(user: Pubkey, rpc: str) -> Dict[str, PositionInfo]:
        if type(user) != Pubkey:
            raise TypeError("user must be of type `solders.pubkey.Pubkey`")
        
        if type(rpc) != str:
            raise TypeError("rpc must be of type `str`")
        
        try:
            session = requests.Session()
            session.headers.update({
                'Content-type': 'application/json', 
                'Accept': 'text/plain',
                'rpc': rpc
            })
            data = json.dumps({
                "user": str(user)
            })
            result = session.post(f"{API_URL}/dlmm/get-all-lb-pair-positions-by-user", data=data).json()
            return {key: PositionInfo(value) for key, value in result.items()}
        except requests.exceptions.HTTPError as e:
            raise HTTPError(f"Error getting all lb pair positions by user: {e}")
        except requests.exceptions.ConnectionError as e:
            raise HTTPError(f"Error connecting to DLMM: {e}")