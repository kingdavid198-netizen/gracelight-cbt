function formatResultDate(student) {
    const createdAt = student && student.createdAt ? new Date(student.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) {
        return student && student.date ? String(student.date) : "N/A";
    }

    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h12"
    }).formatToParts(createdAt);
    const value = type => parts.find(part => part.type === type).value;
    return `${value("day")} ${value("month")} ${value("year")}, ${value("hour")}:${value("minute")} ${value("dayPeriod").toUpperCase()}`;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = formatResultDate;
}
