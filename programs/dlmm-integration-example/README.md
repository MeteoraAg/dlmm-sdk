# DLMM Integration Example

The purpose of the program is to serve as an example on how to integrate with the DLMM program.

### Build

At the root of the project

```
anchor build --program-name dlmm_integration_example
```

### Functionalities

| Endpoint                    | Description                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| initialize_position_manager | Create a position manager, which manage positions under a wallet. It ensure all the positions created will be in continuous price range |
| initialize_position         | Create a position under the position manager                                                                                            |
| add_liquidity               | Add liquidity to a position                                                                                                             |
| remove_liquidity            | Remove liquidity from a position                                                                                                        |
| get_twap                    | Get time weighted average price of a pair                                                                                               |
