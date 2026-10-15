import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.models.database import Base, AICollectionPriority, AICollectionRecommendation
from app.services.collection import calculate_collection_priorities
from datetime import datetime, timedelta

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

def test_calculate_collection_priorities_urgent(db_session):
    # Simulated current date: 2026-07-20
    # Overdue > 30 days and balance >= 50,000 -> Urgent
    due_date = "2026-06-15" # 35 days overdue
    ar_data = [{
        "invoiceId": "INV-URG",
        "invoiceNumber": "INV-900",
        "clientId": "C-1",
        "clientName": "Big Corp",
        "amount": 75000.0,
        "outstandingBalance": 75000.0,
        "dueDate": due_date,
        "daysOverdue": 35,
        "agingBucket": "31-60 Days"
    }]
    
    processed, updated = calculate_collection_priorities(db_session, ar_data, [])
    assert processed == 1
    
    priority = db_session.query(AICollectionPriority).first()
    assert priority is not None
    assert priority.priority_level == "Urgent"
    # Outstanding balance high and overdue > 30
    assert any("Outstanding balance is high" in b for b in priority.explanation_basis)
    assert any("overdue" in b for b in priority.explanation_basis)

    rec = db_session.query(AICollectionRecommendation).first()
    assert rec is not None
    assert rec.priority_id == priority.id
    assert "escalate" in rec.recommended_action.lower()

def test_calculate_collection_priorities_high(db_session):
    # Overdue but not large amount -> High
    due_date = "2026-06-25" # 25 days overdue
    ar_data = [{
        "invoiceId": "INV-HIGH",
        "invoiceNumber": "INV-800",
        "clientId": "C-2",
        "clientName": "Mid Corp",
        "amount": 20000.0,
        "outstandingBalance": 20000.0,
        "dueDate": due_date,
        "daysOverdue": 25,
        "agingBucket": "1-30 Days"
    }]
    
    processed, updated = calculate_collection_priorities(db_session, ar_data, [])
    priority = db_session.query(AICollectionPriority).first()
    assert priority is not None
    assert priority.priority_level == "High"

def test_calculate_collection_priorities_due_soon(db_session):
    # Due in 5 days (<= 7 days) and small balance -> Medium
    due_date = "2026-07-25" 
    ar_data = [{
        "invoiceId": "INV-MED",
        "invoiceNumber": "INV-700",
        "clientId": "C-3",
        "clientName": "Small Corp",
        "amount": 10000.0,
        "outstandingBalance": 10000.0,
        "dueDate": due_date,
        "daysOverdue": 0,
        "agingBucket": "Current"
    }]
    
    processed, updated = calculate_collection_priorities(db_session, ar_data, [])
    priority = db_session.query(AICollectionPriority).first()
    assert priority.priority_level == "Medium"
    assert any("due soon" in b for b in priority.explanation_basis)
