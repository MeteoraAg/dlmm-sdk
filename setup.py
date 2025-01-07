from setuptools import setup, find_packages

setup(
    name="market_making",
    version="0.1",
    packages=find_packages(),
    install_requires=[
        "pytest",
        "numpy",
        "pytest-mock",
        "dlmm",  # Make sure this is installed from your local path
    ],
)
