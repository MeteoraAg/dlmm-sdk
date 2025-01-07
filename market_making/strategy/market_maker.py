class MarketMaker:
    def __init__(self, config):
        self.config = config
        self.active_positions = []
        self.collected_fees = 0
