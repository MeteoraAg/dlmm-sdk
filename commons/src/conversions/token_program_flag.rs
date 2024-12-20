use dlmm_interface::TokenProgramFlags;
use std::ops::Deref;

pub struct TokenProgramFlagWrapper(TokenProgramFlags);

impl Deref for TokenProgramFlagWrapper {
    type Target = TokenProgramFlags;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<u8> for TokenProgramFlagWrapper {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(TokenProgramFlagWrapper(TokenProgramFlags::TokenProgram)),
            1 => Ok(TokenProgramFlagWrapper(TokenProgramFlags::TokenProgram2022)),
            _ => Err(anyhow::anyhow!(
                "Invalid TokenProgramFlags value: {}",
                value
            )),
        }
    }
}
