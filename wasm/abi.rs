// Only ABI conversion and ownership of the UTF-8 result buffer live here.
// f_0_* are generated from main.blyx by the pinned Blyx compiler.
thread_local! {
    static RESPONSE: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

fn store_text(value: String) -> usize {
    let len = value.len();
    RESPONSE.with(|response| *response.borrow_mut() = value);
    len
}

#[unsafe(no_mangle)]
pub extern "C" fn response_ptr() -> *const u8 {
    RESPONSE.with(|response| response.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn predict(hour: i32, month: i32, day: i32, weather: i32, celsius: f64) -> f64 {
    f_0_predict(hour.into(), month.into(), day.into(), weather.into(), celsius)
}

#[unsafe(no_mangle)]
pub extern "C" fn plan(format: i32, month: i32, day: i32, weather: i32, celsius: i32) -> usize {
    store_text(f_0_plan(format.into(), month.into(), day.into(), weather.into(), celsius.into()))
}

#[unsafe(no_mangle)]
pub extern "C" fn preset(id: i32) -> usize {
    store_text(f_0_preset(id.into()))
}

#[unsafe(no_mangle)]
pub extern "C" fn self_test() -> i32 {
    f_0_self_test() as i32
}
