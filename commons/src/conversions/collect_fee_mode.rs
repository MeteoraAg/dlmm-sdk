#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CollectFeeMode {
    InputOnly,
    OnlyY,
}

impl TryFrom<u8> for CollectFeeMode {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(CollectFeeMode::InputOnly),
            1 => Ok(CollectFeeMode::OnlyY),
            _ => Err(anyhow::anyhow!("Invalid CollectFeeMode value: {}", value)),
        }
    }
}
