from app.services.ocr_service import _fallback_heuristic_classification


def test_fallback_classification_official_receipt():
    extracted = _fallback_heuristic_classification("receipt_20260301.png", b"not-a-real-image")

    assert extracted["documentType"] == "OFFICIAL_RECEIPT"
    assert extracted["isAllowed"] is True
    assert extracted["detectedFields"]["amount"] is not None
    assert extracted["detectedFields"]["clientName"] == "Shopee Express"


def test_fallback_rejects_personal_photo():
    extracted = _fallback_heuristic_classification("selfie_profile.jpg", b"fake_bytes")

    assert extracted["documentType"] == "PERSON_PHOTO"
    assert extracted["isAllowed"] is False
    assert extracted["shouldProceedToDuplicateScan"] is False

