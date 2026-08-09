/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { $, addDisposableListener, append, EventHelper, EventType, getWindow, isAncestor } from '../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../base/browser/keyboardEvent.js';
import { KeyCode } from '../../../base/common/keyCodes.js';
import { Disposable, DisposableStore } from '../../../base/common/lifecycle.js';
import { Codicon } from '../../../base/common/codicons.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IThemeService, IColorTheme } from '../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../common/views.js';
import { CompositeBarAction, CompositeBarActionViewItem, IActivityHoverOptions, ICompositeBar, ICompositeBarColors } from './compositeBarActions.js';

/**
 * Carrel: always-visible chevron action at the end of the (top) composite bar
 * that opens a dropdown listing every view container of the sidebar location
 * with per-row pin toggles. Stock VS Code only offers the overflow chevron
 * (shown when items do not fit) with a plain context menu.
 */
export class CompositeViewSwitcherAction extends CompositeBarAction {

	constructor(
		private showSwitcher: () => void
	) {
		super({
			id: 'viewSwitcher.action',
			name: localize('viewSwitcher', "View Switcher"),
			classNames: ThemeIcon.asClassNameArray(Codicon.chevronDown)
		});
	}

	override async run(): Promise<void> {
		this.showSwitcher();
	}
}

export class CompositeViewSwitcherActionViewItem extends CompositeBarActionViewItem {

	private readonly switcher: CompositeBarViewSwitcher;

	constructor(
		action: CompositeBarAction,
		compositeBar: ICompositeBar,
		openComposite: (compositeId: string) => void,
		colors: (theme: IColorTheme) => ICompositeBarColors,
		hoverOptions: IActivityHoverOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
	) {
		super(action, { icon: true, colors, hasPopup: true, hoverOptions, isTabList: true }, () => true, themeService, hoverService, configurationService, keybindingService);
		this.switcher = this._register(instantiationService.createInstance(CompositeBarViewSwitcher, compositeBar, openComposite));
	}

	showSwitcher(): void {
		this.switcher.toggle(this.container);
	}
}

class CompositeBarViewSwitcher extends Disposable {

	private container: HTMLElement | undefined;
	private anchor: HTMLElement | undefined;
	private readonly showDisposables = this._register(new DisposableStore());

	constructor(
		private readonly compositeBar: ICompositeBar,
		private readonly openComposite: (compositeId: string) => void,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
	) {
		super();
	}

	toggle(anchor: HTMLElement): void {
		if (this.container) {
			this.hide();
		} else {
			this.show(anchor);
		}
	}

	private show(anchor: HTMLElement): void {
		this.hide();

		this.anchor = anchor;
		const targetWindow = getWindow(anchor);
		const workbenchContainer = anchor.closest('.monaco-workbench') as HTMLElement | null ?? targetWindow.document.body;

		const container = append(workbenchContainer, $('.carrel-view-switcher'));
		this.container = container;

		this.renderRows(container);

		// Position: directly below the composite bar (the chevron's own icon
		// row), overlapping the sidebar's content area with the same left edge
		// and width. Falls back to right-aligning under the chevron when the
		// sidebar is hidden.
		const anchorRect = anchor.getBoundingClientRect();
		const sidebar = workbenchContainer.querySelector('.part.sidebar') as HTMLElement | null;
		const compositeBarContainer = anchor.closest('.composite-bar-container') as HTMLElement | null;
		if (sidebar) {
			const sidebarRect = sidebar.getBoundingClientRect();
			const barRect = compositeBarContainer?.getBoundingClientRect();
			container.style.top = `${barRect ? barRect.bottom : sidebarRect.top}px`;
			container.style.left = `${sidebarRect.left}px`;
			container.style.width = `${sidebarRect.width}px`;
		} else {
			container.style.top = `${anchorRect.bottom + 4}px`;
			container.style.left = `${Math.max(4, anchorRect.right - container.offsetWidth)}px`;
		}

		// Dismiss on outside mousedown (clicks on the anchor toggle via the action)
		this.showDisposables.add(addDisposableListener(targetWindow.document, EventType.MOUSE_DOWN, e => {
			const target = e.target as HTMLElement | null;
			if (target && this.container && !isAncestor(target, this.container) && !(this.anchor && isAncestor(target, this.anchor))) {
				this.hide();
			}
		}, true));

		// Dismiss on Escape
		this.showDisposables.add(addDisposableListener(targetWindow.document, EventType.KEY_DOWN, e => {
			const keyEvent = new StandardKeyboardEvent(e);
			if (keyEvent.equals(KeyCode.Escape)) {
				EventHelper.stop(e, true);
				this.hide();
			}
		}, true));

		// Dismiss on window blur
		this.showDisposables.add(addDisposableListener(targetWindow, 'blur', () => this.hide()));

		this.showDisposables.add({ dispose: () => { this.container?.remove(); this.container = undefined; this.anchor = undefined; } });
	}

	private renderRows(container: HTMLElement): void {
		const viewContainers = this.viewDescriptorService.getViewContainersByLocation(ViewContainerLocation.Sidebar);
		// Carrel: pinned containers first (in bar order), then unpinned ones,
		// mirroring the bar-then-rest ordering of the reference design.
		const sorted = [...viewContainers].sort((a, b) => {
			const aPinned = this.compositeBar.isPinned(a.id) ? 0 : 1;
			const bPinned = this.compositeBar.isPinned(b.id) ? 0 : 1;
			return aPinned - bPinned || (a.order ?? 0) - (b.order ?? 0);
		});
		// Carrel: highlight the row of the currently active view (reference design).
		const activeId = this.compositeBar.getActiveCompositeId();
		for (const viewContainer of sorted) {
			const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);

			const row = append(container, $('.carrel-view-switcher-row'));
			if (viewContainer.id === activeId) {
				row.classList.add('selected');
			}

			const icon = append(row, $('.carrel-view-switcher-icon'));
			if (ThemeIcon.isThemeIcon(viewContainer.icon)) {
				icon.classList.add(...ThemeIcon.asClassNameArray(viewContainer.icon));
			} else {
				icon.classList.add(...ThemeIcon.asClassNameArray(Codicon.window));
			}

			const title = append(row, $('span.carrel-view-switcher-title'));
			title.textContent = viewContainerModel.title;

			const keybindingId = viewContainerModel.keybindingId;
			const keybindingLabel = keybindingId ? this.keybindingService.lookupKeybinding(keybindingId)?.getLabel() : undefined;
			if (keybindingLabel) {
				const keybinding = append(row, $('span.carrel-view-switcher-keybinding'));
				keybinding.textContent = keybindingLabel;
			}

			const pinned = this.compositeBar.isPinned(viewContainer.id);
			const pin = append(row, $(`.carrel-view-switcher-pin${pinned ? '.pinned' : ''}`));
			pin.classList.add(...ThemeIcon.asClassNameArray(pinned ? Codicon.pinned : Codicon.pin));
			pin.title = pinned ? localize('unpinView', "Unpin from Bar") : localize('pinView', "Pin to Bar");

			// Pin toggle: stay open so several containers can be toggled
			this.showDisposables.add(addDisposableListener(pin, EventType.CLICK, e => {
				EventHelper.stop(e, true);
				const nowPinned = this.compositeBar.isPinned(viewContainer.id);
				if (nowPinned) {
					this.compositeBar.unpin(viewContainer.id);
				} else {
					this.compositeBar.pin(viewContainer.id);
				}
				pin.classList.toggle('pinned', !nowPinned);
				pin.classList.remove(...ThemeIcon.asClassNameArray(nowPinned ? Codicon.pinned : Codicon.pin));
				pin.classList.add(...ThemeIcon.asClassNameArray(nowPinned ? Codicon.pin : Codicon.pinned));
				pin.title = !nowPinned ? localize('unpinView', "Unpin from Bar") : localize('pinView', "Pin to Bar");
			}));

			// Row click: open the view container and close
			this.showDisposables.add(addDisposableListener(row, EventType.CLICK, () => {
				this.openComposite(viewContainer.id);
				this.hide();
			}));
		}
	}

	hide(): void {
		this.showDisposables.clear();
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}
}
