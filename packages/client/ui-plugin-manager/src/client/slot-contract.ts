/**
 * Slots for the Plugins page's tabs, activation guidance, and detail additions.
 * Registrants use `ctx.slots` and need no runtime import of this package.
 * Settings slots are typed in ui-settings so feature plugins need not depend
 * on the navigation shell that hosts their forms.
 */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'

export type { ConfigPageForm, PluginConfigViewProps } from '@deepseek-ai/dsh-client-ui-settings/client'

/** One row of a bundle as a detail contribution sees it. */
export interface PluginRowRef {
  /** The row id as the bundle's patch declares it. */
  readonly rowId: string
  /** The module the row names. */
  readonly moduleName: string
  /** Whether the row's entry runs. */
  readonly enabled: boolean
}

/** One bundle as a detail contribution sees it: the facts a contribution decides on, never the page's own state. */
export interface PluginPackageRef {
  /** The package name. */
  readonly name: string
  /** The installed version, when the Host reports one. */
  readonly version?: string
  /** Whether the profile declares the package dependency. */
  readonly installed: boolean
  /** Readable package location; missing entries can retain a dependency declaration. */
  readonly availability: BundleInfo['availability']
  /** Whether the installation offers this package in Official. */
  readonly official: boolean
  /** Whether the bundle is switched on. */
  readonly enabled: boolean
  /** The rows the bundle declares. */
  readonly rows: readonly PluginRowRef[]
}

/** What a detail page is about: a bundle, one row of a bundle, or an official plugin listed by its `plugins.item` id. */
export type PluginsSubject =
  | { readonly kind: 'bundle'; readonly pkg: PluginPackageRef }
  | { readonly kind: 'row'; readonly pkg: PluginPackageRef; readonly row: PluginRowRef }
  | { readonly kind: 'item'; readonly id: string }

/** The owner props every detail contribution is rendered with. */
export interface PluginDetailProps {
  /** The subject of the open page; an entry renders null for a subject it has nothing for. */
  readonly subject: PluginsSubject
}

/** One user-requested bundle activation and navigation to its configuration page. */
export interface PluginActivationOwnerProps {
  readonly packageName: string
  /** Dismiss guidance for this activation. */
  readonly onDismiss: () => void
  /** Dismiss guidance and open this bundle's detail page. */
  readonly onOpenDetails: () => void
}

/** An exact version a tab asks the Plugins page to install, with the text the install dialog shows for it. */
export interface PluginTabInstall {
  /** The install spec, such as `name@version` or a pinned `git+https` URL. */
  readonly spec: string
  /** The registry to ask first for this install only; absent keeps the dialog's registry choice. */
  readonly registry?: string
  /** Display name of the plugin, already localized. */
  readonly title: string
  /** The version being installed. */
  readonly version: string
}

/** A newer Git version of an installed bundle that a tab asks the Plugins page to update to. */
export interface PluginTabUpdate {
  /** npm package name of the installed bundle. */
  readonly packageName: string
  /** The target version. */
  readonly version: string
  /** The Git spec that installs `version`, pinned to a full commit of the repository directory the bundle came from. */
  readonly spec: string
}

/** Owner props of a page tab another plugin contributes, such as Discover. */
export interface PluginTabProps {
  /**
   * Install an exact version the person already confirmed: the page's install dialog opens at its check and progress
   * screens, without the spec form, and names the plugin and version above the spec.
   * @param target - the spec, optional registry, and display text.
   */
  readonly install: (target: PluginTabInstall) => void
  /**
   * Open the page's update dialog at its confirmation for a bundle the Host lists with `update: 'git'`, from the
   * version the page lists; nothing opens before the page has listed the bundle or while another update runs. The
   * update removes the installed version, installs the target, and installs the removed version again when that fails.
   * @param target - the package, the target version, and its Git spec.
   */
  readonly update: (target: PluginTabUpdate) => void
  /**
   * Switch to the Installed tab and open a bundle's page, whose back button returns to the calling tab.
   * @param packageName - npm package name of the bundle.
   */
  readonly openPackage: (packageName: string) => void
}

/** Add-plugin menu actions, independent of any selected bundle or Session. */
export interface PluginAddActionsProps {
  /** Close the add-plugin menu before starting the contributed action. */
  readonly onDismiss: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Additional MenuItemButton rows after installation: 72px high, with a title and a description capped at two lines. */
    'plugins.add.actions': { kind: 'list'; scope: 'root'; owner: PluginAddActionsProps }
    /**
     * Tabs after the page's own Installed tab, such as Discover: `label` names the tab and `order` places it. The
     * page renders the selected entry under its header and tabs; the entry draws its own content and installs and
     * updates through the owner's `install` and `update`.
     */
    'plugins.tab': { kind: 'list'; scope: 'root'; owner: PluginTabProps }
    /** Optional guidance after the user enables a bundle from the list, keyed by npm package name. */
    'plugins.bundle.activation': { kind: 'keyed'; scope: 'root'; owner: PluginActivationOwnerProps }
    /**
     * Controls at the head of a detail page, before the page's own switch and
     * uninstall, rendered with the page's subject. An entry renders null for a
     * subject it has no control for.
     */
    'plugins.detail.actions': { kind: 'list'; scope: 'root'; owner: PluginDetailProps }
    /**
     * Tags beside a detail page's title, after the version, beta, and problem
     * tags the page draws itself, rendered with the page's subject.
     */
    'plugins.detail.badge': { kind: 'list'; scope: 'root'; owner: PluginDetailProps }
    /**
     * Sections under a detail page's own content: after the source on a bundle's
     * page, after the configuration on a row's or an official plugin's page.
     * An entry draws its own section chrome and renders null for a subject it
     * has nothing for.
     */
    'plugins.detail.section': { kind: 'list'; scope: 'root'; owner: PluginDetailProps }
  }
}
