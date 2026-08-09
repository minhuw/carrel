/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use console::style;

/// Minimum label width so values align across banner lines.
const BANNER_LABEL_WIDTH: usize = 9;

/// Prints a single `➜  Label:   value` line inside a banner.
pub fn print_banner_line(label: &str, value: &str) {
	println!(
		"  {}  {} {}",
		style("➜").green().bold(),
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
