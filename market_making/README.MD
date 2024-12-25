An example for market making with DLMM

### Toolchain

```
channel = 1.76.0
```

If you're using M1 chip

```
channel = 1.76.0
target triple = x86_64-apple-darwin
# Eg: 1.76.0-x86_64-apple-darwin
```

### Build

```
cargo build
```

### Run

target/debug/market_making --help

### Check positions:

`http://localhost:8080/check_positions`
