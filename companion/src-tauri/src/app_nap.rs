//! Keeps this process exempt from macOS App Nap while a focus session is
//! live.
//!
//! This is separate from (and in addition to) the window-visibility fix in
//! main.rs's CloseRequested handler. That fix keeps the window's isVisible
//! state true (miniaturized, not ordered-out) so a *closed* window doesn't
//! immediately suspend the camera. But App Nap is a distinct, time-based
//! power-management path: macOS can still throttle a backgrounded process's
//! timers/media after roughly a minute of the app not being frontmost, even
//! though its window is properly miniaturized. Real-world symptom: minimize
//! the window (unaffected by the CloseRequested fix — it already used
//! native miniaturize), wait about a minute, and the camera indicator drops
//! anyway. `NSProcessInfo` activity tokens are the documented Apple API for
//! declaring "this process is doing real user-relevant work, do not nap it."
//!
//! Held only while a session is active or paused (never for the idle tray
//! app), so App Nap still applies normally the rest of the time.

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObjectProtocol, ProtocolObject};
    use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

    pub struct AppNapGuard(Retained<ProtocolObject<dyn NSObjectProtocol>>);

    // Apple documents NSProcessInfo's activity API as safe to call from any
    // thread. This wrapper only ever moves the token into/out of our own
    // Mutex-guarded storage and passes it straight back to endActivity:.
    unsafe impl Send for AppNapGuard {}

    pub fn begin(reason: &str) -> AppNapGuard {
        let info = NSProcessInfo::processInfo();
        let reason = NSString::from_str(reason);
        // UserInitiatedAllowingIdleSystemSleep: exempt from App Nap-style
        // throttling without holding the whole Mac awake (the existing
        // sleep/wake camera-recovery path already handles a real system
        // sleep).
        let token = info.beginActivityWithOptions_reason(
            NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
            &reason,
        );
        AppNapGuard(token)
    }

    pub fn end(guard: AppNapGuard) {
        let info = NSProcessInfo::processInfo();
        // Safety: `guard.0` is exactly the token `begin()` obtained from
        // this same process's matching `beginActivityWithOptions:reason:`.
        unsafe { info.endActivity(&guard.0) };
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub struct AppNapGuard;

    pub fn begin(_reason: &str) -> AppNapGuard {
        AppNapGuard
    }

    pub fn end(_guard: AppNapGuard) {}
}

pub use imp::{begin, end, AppNapGuard};

#[cfg(test)]
mod tests {
    use super::{begin, end};

    #[test]
    fn begin_and_end_round_trip_without_crashing() {
        let token = begin("test");
        end(token);
    }

    #[test]
    fn repeated_begin_end_cycles_are_safe() {
        for _ in 0..3 {
            let token = begin("test");
            end(token);
        }
    }
}
