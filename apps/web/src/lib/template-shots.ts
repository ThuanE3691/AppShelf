import type { StaticImageData } from "next/image";
import type { SiteTemplate } from "@appshelf/db";
import agencyDesktop from "../../public/templates/agency-desktop.webp";
import agencyMobile from "../../public/templates/agency-mobile.webp";
import restaurantDesktop from "../../public/templates/restaurant-desktop.webp";
import restaurantMobile from "../../public/templates/restaurant-mobile.webp";
import servicesDesktop from "../../public/templates/services-desktop.webp";
import servicesMobile from "../../public/templates/services-mobile.webp";

/**
 * Screenshots of the live showcase sites (`/<template>-demo/`) captured from the
 * WordPress network: desktop at 1440x900 (stored 960x600) and the top of the
 * mobile view at 390px (stored 360x480).
 */
export const TEMPLATE_SHOTS: Record<SiteTemplate, { desktop: StaticImageData; mobile: StaticImageData }> = {
  restaurant: { desktop: restaurantDesktop, mobile: restaurantMobile },
  agency: { desktop: agencyDesktop, mobile: agencyMobile },
  services: { desktop: servicesDesktop, mobile: servicesMobile },
};
