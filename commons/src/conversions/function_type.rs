#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FunctionType {
    Undetermined,
    LiquidityMining,
    LimitOrder,
}

impl TryFrom<u8> for FunctionType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(FunctionType::Undetermined),
            1 => Ok(FunctionType::LiquidityMining),
            2 => Ok(FunctionType::LimitOrder),
            _ => Err(anyhow::anyhow!("Invalid FunctionType value: {}", value)),
        }
    }
}
