class QuoteCollector:
    def __init__(self, window_size, sampling_interval, max_gap_fill=None):
        self.window_size = window_size
        self.sampling_interval = sampling_interval
        self.max_gap_fill = max_gap_fill
