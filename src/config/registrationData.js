const COUNTIES = [
  { code: "001", name: "Mombasa" },
  { code: "002", name: "Kwale" },
  { code: "003", name: "Kilifi" },
  { code: "004", name: "Tana River" },
  { code: "005", name: "Lamu" },
  { code: "006", name: "Taita-Taveta" },
  { code: "007", name: "Garissa" },
  { code: "008", name: "Wajir" },
  { code: "009", name: "Mandera" },
  { code: "010", name: "Marsabit" },
  { code: "011", name: "Isiolo" },
  { code: "012", name: "Meru" },
  { code: "013", name: "Tharaka-Nithi" },
  { code: "014", name: "Embu" },
  { code: "015", name: "Kitui" },
  { code: "016", name: "Machakos" },
  { code: "017", name: "Makueni" },
  { code: "018", name: "Nyandarua" },
  { code: "019", name: "Nyeri" },
  { code: "020", name: "Kirinyaga" },
  { code: "021", name: "Murang'a" },
  { code: "022", name: "Kiambu" },
  { code: "023", name: "Turkana" },
  { code: "024", name: "West Pokot" },
  { code: "025", name: "Samburu" },
  { code: "026", name: "Trans Nzoia" },
  { code: "027", name: "Uasin Gishu" },
  { code: "028", name: "Elgeyo-Marakwet" },
  { code: "029", name: "Nandi" },
  { code: "030", name: "Baringo" },
  { code: "031", name: "Laikipia" },
  { code: "032", name: "Nakuru" },
  { code: "033", name: "Narok" },
  { code: "034", name: "Kajiado" },
  { code: "035", name: "Kericho" },
  { code: "036", name: "Bomet" },
  { code: "037", name: "Kakamega" },
  { code: "038", name: "Vihiga" },
  { code: "039", name: "Bungoma" },
  { code: "040", name: "Busia" },
  { code: "041", name: "Siaya" },
  { code: "042", name: "Kisumu" },
  { code: "043", name: "Homa Bay" },
  { code: "044", name: "Migori" },
  { code: "045", name: "Kisii" },
  { code: "046", name: "Nyamira" },
  { code: "047", name: "Nairobi" }
];

const INSTITUTION_CATEGORIES = [
  { code: "P", label: "Primary" },
  { code: "PJ", label: "Primary/Junior" },
  { code: "JS", label: "Junior Secondary" },
  { code: "SS", label: "Senior Secondary" }
];

const KENYA_POSTAL_CODES = [
  { postal_code: "00100", town: "Nairobi GPO" },
  { postal_code: "00200", town: "City Square Nairobi" },
  { postal_code: "00502", town: "Karen" },
  { postal_code: "00600", town: "Sarit Centre" },
  { postal_code: "01000", town: "Thika" },
  { postal_code: "10100", town: "Nyeri" },
  { postal_code: "10200", town: "Murang'a" },
  { postal_code: "10300", town: "Kerugoya" },
  { postal_code: "20100", town: "Nakuru" },
  { postal_code: "20117", town: "Naivasha" },
  { postal_code: "20200", town: "Kericho" },
  { postal_code: "20300", town: "Nyahururu" },
  { postal_code: "30100", town: "Eldoret" },
  { postal_code: "30200", town: "Kitale" },
  { postal_code: "40100", town: "Kisumu" },
  { postal_code: "40200", town: "Kisii" },
  { postal_code: "40300", town: "Homa Bay" },
  { postal_code: "40400", town: "Suna" },
  { postal_code: "50100", town: "Kakamega" },
  { postal_code: "50200", town: "Bungoma" },
  { postal_code: "50300", town: "Busia" },
  { postal_code: "60100", town: "Embu" },
  { postal_code: "60200", town: "Meru" },
  { postal_code: "70100", town: "Garissa" },
  { postal_code: "80100", town: "Mombasa" },
  { postal_code: "80200", town: "Malindi" },
  { postal_code: "80300", town: "Kilifi" },
  { postal_code: "80400", town: "Ukunda" },
  { postal_code: "80500", town: "Lamu" },
  { postal_code: "90100", town: "Machakos" },
  { postal_code: "90200", town: "Kitui" },
  { postal_code: "90300", town: "Makueni" }
];

const COUNTY_BY_CODE = Object.fromEntries(COUNTIES.map((item) => [item.code, item]));
const COUNTY_BY_NAME = Object.fromEntries(COUNTIES.map((item) => [item.name.toLowerCase(), item]));
const INSTITUTION_CATEGORY_BY_LABEL = Object.fromEntries(
  INSTITUTION_CATEGORIES.map((item) => [item.label.toLowerCase(), item])
);
const INSTITUTION_CATEGORY_BY_CODE = Object.fromEntries(
  INSTITUTION_CATEGORIES.map((item) => [item.code, item])
);

module.exports = {
  COUNTIES,
  INSTITUTION_CATEGORIES,
  KENYA_POSTAL_CODES,
  COUNTY_BY_CODE,
  COUNTY_BY_NAME,
  INSTITUTION_CATEGORY_BY_LABEL,
  INSTITUTION_CATEGORY_BY_CODE
};
