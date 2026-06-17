"""Tests for the generated calculator CLI."""

from __future__ import annotations

import calculator
import pytest


def test_operations() -> None:
    assert calculator.add(2, 3) == 5
    assert calculator.subtract(7, 2) == 5
    assert calculator.multiply(4, 3) == 12
    assert calculator.divide(8, 2) == 4


def test_divide_by_zero() -> None:
    with pytest.raises(ValueError, match="Cannot divide by zero"):
        calculator.divide(1, 0)


def test_calculate_rejects_unknown_operation() -> None:
    with pytest.raises(ValueError, match="Unknown operation"):
        calculator.calculate("power", 2, 3)


def test_cli_main_outputs_result(capsys: pytest.CaptureFixture[str]) -> None:
    assert calculator.main(["multiply", "6", "7"]) == 0
    assert capsys.readouterr().out.strip() == "42.0"
