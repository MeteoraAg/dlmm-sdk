# DLMM Python SDK

## Using the SDK
1. Install the SDK and other necessary libraries
```bash
pip install dlmm solders
```
2. Initialize DLMM instance
```python
from dlmm import DLMM_CLIENT
from solders.pubkey import Pubkey

RPC = "https://api.devnet.solana.com"
pool_address = Pubkey.from_string("3W2HKgUa96Z69zzG3LK1g8KdcRAWzAttiLiHfYnKuPw5") # You can get your desired pool address from the API https://dlmm-api.meteora.ag/pair/all
dlmm = DLMM_CLIENT.create(pool_address, RPC) # Returns DLMM object instance
```
Now you can use the `dlmm` object to interact with different methods of the [DLMM](https://docs.meteora.ag/dlmm/dlmm-integration/dlmm-sdk).

## Setup and Run (Development)
1. Install [poetry](https://python-poetry.org/docs/#installing-with-the-official-installer/).
2. CD to `python-client/dlmm` and Run `poetry install` to install the dependencies.
3. Open another terminal, CD to `ts-client`.
4. Install the dependencies using `npm install` and run the server using `npm start-server`.
5. In the `dlmm.py`, if the API_URL is not already set to `localhost:3000`.
6. Add new dependencies using `poetry add package_name`
7. Now you can add and modify the python code and add tests as required under `dlmm/tests` directory and test them using `poetry run pytest`.

