use loom::sync::atomic::{AtomicUsize, Ordering};
use loom::sync::{Arc, Mutex};
use loom::thread;
use std::collections::{HashMap, HashSet};

#[test]
fn close_transition_is_idempotent() {
    loom::model(|| {
        let state = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let state = Arc::clone(&state);
            handles.push(thread::spawn(move || {
                let _ = state.compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire);
                state.store(2, Ordering::Release);
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(state.load(Ordering::Acquire), 2);
    });
}

#[test]
fn pending_ack_resolves_at_most_once() {
    loom::model(|| {
        let pending = Arc::new(Mutex::new(HashMap::from([("message", false)])));
        let successes = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let pending = Arc::clone(&pending);
            let successes = Arc::clone(&successes);
            handles.push(thread::spawn(move || {
                if pending.lock().unwrap().remove("message").is_some() {
                    successes.fetch_add(1, Ordering::AcqRel);
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(successes.load(Ordering::Acquire), 1);
    });
}

#[test]
fn deduplication_claims_one_executor() {
    loom::model(|| {
        let keys = Arc::new(Mutex::new(HashSet::new()));
        let executions = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for _ in 0..2 {
            let keys = Arc::clone(&keys);
            let executions = Arc::clone(&executions);
            handles.push(thread::spawn(move || {
                if keys.lock().unwrap().insert("operation") {
                    executions.fetch_add(1, Ordering::AcqRel);
                }
            }));
        }
        for handle in handles {
            handle.join().unwrap();
        }
        assert_eq!(executions.load(Ordering::Acquire), 1);
    });
}
