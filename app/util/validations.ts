export const validateEmail = (email: string) => {
    if (!email) return "";
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email) ? "" : "Invalid email format";
};

export const validatePhone = (phone: string) => {
    if (!phone) return "";
    const regex = /^(\+|0)?[\d\s\-()]{6,20}$/;
    return regex.test(phone) ? "" : "Enter a valid phone number";
};

export const validateName = (name: string) => {
    if (!name) return "";
    const regex = /^(?=.*[a-zA-Z])[a-zA-Z0-9._-][a-zA-Z0-9 ._-]*$/;
    return regex.test(name) ? "" : "Invalid name";
};
export const validateNoHtml = (value: string) => {
    if (!value) return "";

    const regex = /^[^<>]*$/;

    return regex.test(value)
        ? ""
        : "HTML tags are not allowed";
};

export const validateNumberOnly = (value: string) => {
    if (!value) return "";

    const regex = /^[0-9]+$/;

    return regex.test(value)
        ? ""
        : "Only numbers are allowed";
};