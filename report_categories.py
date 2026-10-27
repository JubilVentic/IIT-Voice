"""Campus concern taxonomy from the project's scope diagram."""

CATEGORY_GROUPS = (
    {
        "name": "Physical & Environment",
        "categories": [
            "Facilities, Infrastructure & Maintenance",
            "Safety, Security & Risk",
            "Environmental, Aesthetics & Landscaping",
        ],
    },
    {
        "name": "Digital & Academic",
        "categories": [
            "ICT, Internet & Digital Services",
            "Student Needs & Learning Environment",
            "Academic, Research & Innovation Enterprises",
        ],
    },
    {
        "name": "Operations & Governance",
        "categories": [
            "Administrative, HR & Workplace",
            "Procurement, Property & Finance",
            "Public Information, Policy & Legal",
        ],
    },
)
CATEGORIES = tuple(category for group in CATEGORY_GROUPS for category in group["categories"])
LEGACY_CATEGORIES = {
    "Safety": "Safety, Security & Risk",
    "Repair & maintenance": "Facilities, Infrastructure & Maintenance",
    "Student needs": "Student Needs & Learning Environment",
}
DEFAULT_OFFICES = dict(
    zip(
        CATEGORIES,
        (
            "Physical Plant",
            "Security & Investigation",
            "Physical Plant",
            "ICT",
            "Student Services",
            "Research & Innovation",
            "Administrative & HR",
            "Procurement & Finance",
            "Public Information & Legal",
        ),
    )
)


def normalize_categories(primary, categories):
    if (
        not isinstance(primary, str)
        or not isinstance(categories, list)
        or len(categories) > len(CATEGORIES)
    ):
        raise ValueError("Choose a primary category and up to nine valid categories.")
    primary = LEGACY_CATEGORIES.get(primary, primary)
    if primary not in CATEGORIES or any(not isinstance(item, str) for item in categories):
        raise ValueError("Invalid report category.")
    categories = [LEGACY_CATEGORIES.get(item, item) for item in categories]
    if any(item not in CATEGORIES for item in categories):
        raise ValueError("Invalid report category.")
    return primary, list(dict.fromkeys([primary, *categories]))
