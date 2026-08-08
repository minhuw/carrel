/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use console::style;

/// Minimum label width so values align across banner lines.
const BANNER_LABEL_WIDTH: usize = 9;

const ASCII_BANNER_MARKER: &str = ">";
const UTF8_BANNER_MARKER: &str = "➜";

#[cfg(windows)]
pub(crate) const PARENT_STDOUT_SUPPORTS_UTF8_ENV: &str = "VSCODE_CLI_PARENT_STDOUT_SUPPORTS_UTF8";

pub(crate) fn banner_marker() -> &'static str {
	utf8_or_ascii(UTF8_BANNER_MARKER, ASCII_BANNER_MARKER)
}

pub(crate) fn utf8_or_ascii<'a>(utf8: &'a str, ascii: &'a str) -> &'a str {
	#[cfg(windows)]
	let supports_utf8 = match std::env::var(PARENT_STDOUT_SUPPORTS_UTF8_ENV).as_deref() {
		Ok("1") => true,
		Ok("0") => false,
		_ => stdout_supports_utf8(),
	};
	#[cfg(not(windows))]
	let supports_utf8 = true;

	if supports_utf8 {
		utf8
	} else {
		ascii
	}
}

#[cfg(windows)]
pub(crate) fn stdout_supports_utf8() -> bool {
	use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
	use windows_sys::Win32::System::Console::{
		GetConsoleMode, GetConsoleOutputCP, GetStdHandle, STD_OUTPUT_HANDLE,
	};

	const UTF8_CODE_PAGE: u32 = 65001;

	let stdout = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
	if stdout.is_null() || stdout == INVALID_HANDLE_VALUE {
		return false;
	}

	let mut mode = 0;
	if unsafe { GetConsoleMode(stdout, &mut mode) } == 0 {
		// Files and pipes carry UTF-8 bytes without console code-page decoding.
		return true;
	}

	unsafe { GetConsoleOutputCP() == UTF8_CODE_PAGE }
}

/// Prints a single `➜  Label:   value` line inside a banner.
pub fn print_banner_line(label: &str, value: &str) {
	println!(
		"  {}  {} {}",
		style(banner_marker()).green().bold(),
		style(format!(
			"{label}:{:>pad$}",
			"",
			pad = BANNER_LABEL_WIDTH.saturating_sub(label.len() + 1)
		))
		.bold(),
		style(value).cyan(),
	);
}

/// Prints a trailing blank line to close a banner.
pub fn print_banner_footer() {
	println!();
}
